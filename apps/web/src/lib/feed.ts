import { query } from './db';
import { cached } from './cache';
import { cleanTagList, isJunkTag } from './strip-urls';

// TTL for hot reads. 60s is the sweet spot: tags / hot / trending change at
// most every few minutes (a publish or a rollback). One minute of stale tag
// cloud is invisible to humans and saves orders of magnitude on JSON_TABLE
// full scans once the corpus grows. Tuned via env so ops can drop this for
// incident debugging without a code change.
// 默认 30s — 首页 "为你推荐 / 最新" tab 切换是高频动作,每次都跑一遍
// ROW_NUMBER 去重 + COUNT(DISTINCT) 在本地 MySQL 上 200-400ms,体感明显卡顿。
// 30s 内同一份 list 走 Redis 直返,基本零延迟;点赞 / 评论数也只滞后半分钟,
// 在卡片场景里几乎不可感知。需要更实时可在 .env 里 `FEED_CACHE_TTL=0` 关闭。
const HOT_TTL = Number(process.env.FEED_CACHE_TTL ?? 30);

export interface ArticleCardRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  cover_sizes: Record<string, string> | null;
  /** Fallback thumbnail from raw_items.media_urls[0] — used by ArticleCard
   *  when cover_url/cover_sizes are null (cover agent hasn't run yet).
   *  Always proxied through /img-proxy because X CDN hot-link-protects. */
  cover_fallback: string | null;
  /** Source UUID — needed by /img-proxy to apply platform-aware
   *  Referer/Cookie when fetching the fallback image. */
  source_id: string | null;
  /** Computed flags from raw_items.video_urls / media_urls. Drive the corner
   *  badge on cards and the 视频/图片 filtered sections on the landing. */
  has_video: boolean;
  has_image: boolean;
  /** First video URL (raw_items.video_urls[0]) — kept for the article detail
   *  player. Cards no longer need this for duration because we now ship
   *  `duration_sec` from the DB directly. */
  video_url: string | null;
  /** Real playback duration in seconds, server-rendered from items.duration_sec.
   *  Populated by the ingestion pipeline via ffprobe on each crawled MP4 — so
   *  cards render the correct "5:32" SSR-clean without waiting for a client
   *  video metadata round trip (which 跨域/慢网 上 often stalls on fallback). */
  duration_sec: number | null;
  category: string | null;
  tags: string[];
  published_at: string | null;
  source: string | null;
  /** sources.platform — XPost / 文章详情 用它判断是否手工源:
   *  manual → 直接显示 source.name 当公开名;其他 → 走 virtualBlogger 哈希化名。 */
  source_platform: string | null;
  /** sources.avatar_url — 爬虫抓 X 时存的博主头像 URL。XPost / XProfileHeader
   *  优先用它渲染 <img>,空时回落到渐变色块 + 首字母。 */
  source_avatar: string | null;
  /** 原平台真实 @handle (X 上 = `@${screen_name}`)。卡片头部 @后面优先用它,
   *  没有时(非 X 平台)回落到 virtualBlogger 派生的 handle。 */
  source_handle: string | null;
  /** content character count, used for the 时长 bucket */
  content_length: number;
  /** 累计点赞数 — 由 /like/:slug 端点维护,卡片角标 / 文章页 LikeButton 都读这列。 */
  likes: number;
  /** 30 天滚动 PV — items.pv_30d 物化列,由 analytics worker 每小时刷。
   *  卡片在 meta 行展示,可以让用户在列表页看到热度信号。 */
  pv_30d: number;
  /** 评论数 — 关联 comments 表的 COUNT。卡片底栏 CommentIcon 旁边显示。 */
  comment_count: number;
}

export interface TagCount { tag: string; count: number }

// 本站匿名 + X 镜像评论合计 — 物化进 items.comment_count(0026 迁移)。
// 写时维护:site-comments.ts 发评论 INSERT 后 + 1;x-comments worker 每 item
// 同步完按 SQL 重算一次,保证 UPSERT(复爬同评论)和 cascade delete 都准。
// 读侧任何用 ARTICLE_COLS / hot_score 公式的地方现在直接读 i.comment_count 列。
const COMMENT_COUNT_EXPR = `i.comment_count`;

// Items joined to their raw counterpart so we can fall back to the first
// raw media URL when the cover agent hasn't generated a cover_url yet.
// `cover_fallback` is routed through /img-proxy on render to handle X CDN
// hot-link protection — same path as the article detail gallery uses.
const ARTICLE_COLS = `
  i.id, i.slug, i.title, i.summary, i.source_id,
  i.cover_url, i.cover_sizes, i.category, i.tags,
  i.published_at, i.duration_sec,
  -- 展示用查看数:本站累计 PV + X 原推累计 view_count(x-comments worker 同步)。
  -- 两者语义不严格等价,但前端 👁️ 想显示一个最大、最直观的"总热度"。
  (i.pv_30d + COALESCE(i.external_views, 0)) AS pv_30d,
  i.likes,
  COALESCE(s.display_name, s.name) AS source,
  s.platform AS source_platform,
  s.avatar_url AS source_avatar,
  -- 原平台真实 @handle:X 上是 external_id(=screen_name),前面拼 @。
  -- 其它平台不展示 handle, virtualBlogger 兜底走 source_id 哈希。
  CASE WHEN s.platform = 'x' THEN CONCAT('@', s.external_id) ELSE NULL END AS source_handle,
  -- 本站匿名评论 + X 同步评论合并计数,跟文章页"评论 · N"标题一致。
  -- 表达式抽到 COMMENT_COUNT_EXPR 常量,因为 hot_score 公式也要乘它,
  -- 而 MySQL 不允许同层 SELECT 引用兄弟 SELECT 的别名。
  ${COMMENT_COUNT_EXPR} AS comment_count,
  JSON_UNQUOTE(JSON_EXTRACT(r.media_urls, '$[0]')) AS cover_fallback,
  JSON_UNQUOTE(JSON_EXTRACT(r.video_urls, '$[0]')) AS video_url,
  (JSON_LENGTH(r.video_urls) > 0) AS has_video,
  (JSON_LENGTH(r.media_urls) > 0) AS has_image,
  COALESCE(CHAR_LENGTH(i.content), 0) AS content_length
`;
const ARTICLE_FROM = `FROM items i
  JOIN sources s ON s.id = i.source_id
  LEFT JOIN raw_items r ON r.id = i.raw_item_id`;

/** Most-viewed articles in the trailing window. Falls back to recency when
 *  analytics has nothing yet (cold-start). Cached: this aggregates over the
 *  whole analytics_daily table and is loaded by every landing-page render. */
export async function getHot(opts: { limit?: number; days?: number } = {}): Promise<ArticleCardRow[]> {
  const limit = opts.limit ?? 8;
  const days = opts.days ?? 7;
  return cached(`hot:${limit}:${days}`, HOT_TTL, async () => {
    // 与 getFiltered(sort=hot)同一权重公式: pv * 0.5 + likes * 0.5
    // 这里 pv 用 N 天滚动聚合(live SUM),而非 pv_30d 物化列 —
    // 首页"近 7 天热门精选"想要更实时的反应,值得多花一次 aggregate。
    const rows = await query<ArticleCardRow & { pv: number; hot_score: number }>(
      `SELECT ${ARTICLE_COLS},
              COALESCE(SUM(a.pv), 0) AS pv,
              (COALESCE(SUM(a.pv), 0) * 0.5 + i.likes * 0.5) AS hot_score
       ${ARTICLE_FROM}
       LEFT JOIN analytics_daily a
         ON a.item_id = i.id
        AND a.date >= DATE_SUB(CURDATE(), INTERVAL $1 DAY)
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
       GROUP BY i.id
       ORDER BY hot_score DESC, i.published_at DESC
       LIMIT $2`,
      [days, limit],
    );
    return rows.map(normalize);
  });
}

/** Latest articles that have at least one video. `kind: 'video'` filters on
 *  raw_items.video_urls being non-empty; `kind: 'image'` filters on items
 *  with media but NO video so the two sections don't double-count. */
export async function getMediaLatest(opts: { kind: 'video' | 'image'; limit?: number } = { kind: 'video' }): Promise<ArticleCardRow[]> {
  const limit = opts.limit ?? 12;
  const cond = opts.kind === 'video'
    ? 'JSON_LENGTH(r.video_urls) > 0'
    : '(JSON_LENGTH(r.media_urls) > 0 AND COALESCE(JSON_LENGTH(r.video_urls), 0) = 0)';
  return cached(`media:${opts.kind}:${limit}`, HOT_TTL, async () => {
    const rows = await query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       ${ARTICLE_FROM}
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND ${cond}
       ORDER BY i.published_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map(normalize);
  });
}

export async function getLatest(opts: { limit?: number; offset?: number } = {}): Promise<ArticleCardRow[]> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  // Only cache the head page (offset=0) — that's the one rendered on every
  // landing page hit. Deeper paginations have unbounded key cardinality and
  // are accessed rarely; not worth the Redis pollution.
  const exec = async () => {
    const rows = await query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       ${ARTICLE_FROM}
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
       ORDER BY i.published_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(normalize);
  };
  if (offset === 0) return cached(`latest:${limit}`, HOT_TTL, exec);
  return exec();
}

/** Length bucket — unifies "reading time" (text articles) and "playback
 *  time" (video posts) under one filter. Boundaries:
 *    short  < 5 min  → text < 1000 chars  OR  video duration <  300s
 *    medium 5-15 min → text < 3000 chars  OR  video duration <  900s
 *    long   > 15 min → text ≥ 3000 chars  OR  video duration ≥  900s
 *  Reading speed used: ~200 zh-chars/min. */
export type LengthBucket = 'short' | 'medium' | 'long';
export const LENGTH_BUCKETS: Record<
  LengthBucket,
  { min: number; max: number | null; minSec: number; maxSec: number | null; label: string }
> = {
  short:  { min: 0,    max: 1000,  minSec: 0,   maxSec: 300,  label: '短(<5 分钟)' },
  medium: { min: 1000, max: 3000,  minSec: 300, maxSec: 900,  label: '中(5-15 分钟)' },
  long:   { min: 3000, max: null,  minSec: 900, maxSec: null, label: '长(>15 分钟)' },
};

export type DateBucket = '7d' | '30d' | '90d' | 'all';
export const DATE_BUCKETS: Record<DateBucket, { days: number | null; label: string }> = {
  '7d':  { days: 7,    label: '近 7 天' },
  '30d': { days: 30,   label: '近 30 天' },
  '90d': { days: 90,   label: '近 90 天' },
  'all': { days: null, label: '全部时间' },
};

export interface FeedFilter {
  category?: string;
  tag?: string;
  /** 题材 — drills into items.keywords (semantic genre/subject), distinct
   *  from `tag` which targets the free-form items.tags array. */
  keyword?: string;
  /** Filter by source display name. */
  source?: string;
  /** Filter by source UUID — preferred for topic-by-source pages because the
   *  id is stable across renames. */
  sourceId?: string;
  length?: LengthBucket;
  date?: DateBucket;
  /** Filter to items whose raw post carries video / image media. Drives the
   *  视频 / 图片 top-nav tabs. `image` excludes posts that ALSO have video so
   *  the two surfaces don't double-count the same article. */
  media?: 'video' | 'image';
  /** sort: 'latest' (default) | 'hot' (PV desc) */
  sort?: 'latest' | 'hot';
  limit?: number;
  offset?: number;
}

export async function getFiltered(f: FeedFilter): Promise<{ items: ArticleCardRow[]; total: number }> {
  // Cache key only when the filter is "reasonable" — long-tail keyword/source
  // combos would blow up Redis key cardinality. The home/category/tag/topic
  // pages all stay inside the cacheable set: tag/category/keyword/media/sort
  // + small limit/offset. Anything with `source` / `sourceId` / `length` /
  // `date` / large offset bypasses the cache and hits MySQL directly.
  const limit = f.limit ?? 24;
  const offset = f.offset ?? 0;
  const cacheable =
    !f.source && !f.sourceId && !f.length && !f.date &&
    limit <= 50 && offset <= 200;
  if (cacheable) {
    const key = `filtered:${f.sort ?? 'latest'}:${f.media ?? ''}:${f.tag ?? ''}:${f.category ?? ''}:${f.keyword ?? ''}:${limit}:${offset}`;
    return cached(key, HOT_TTL, () => getFilteredUncached(f));
  }
  return getFilteredUncached(f);
}

async function getFilteredUncached(f: FeedFilter): Promise<{ items: ArticleCardRow[]; total: number }> {
  const limit = f.limit ?? 24;
  const offset = f.offset ?? 0;
  const where: string[] = ["i.status IN ('PUBLISHED','DISTRIBUTED')"];
  const params: any[] = [];
  let p = 1;

  if (f.category) { where.push(`i.category = $${p++}`);  params.push(f.category); }
  if (f.source)   { where.push(`s.name = $${p++}`);      params.push(f.source); }
  if (f.sourceId) { where.push(`i.source_id = $${p++}`); params.push(f.sourceId); }
  if (f.tag)      { where.push(`JSON_CONTAINS(i.tags, JSON_QUOTE($${p++}))`);     params.push(f.tag); }
  if (f.keyword)  { where.push(`JSON_CONTAINS(i.keywords, JSON_QUOTE($${p++}))`); params.push(f.keyword); }
  if (f.media === 'video') {
    where.push(`JSON_LENGTH(r.video_urls) > 0`);
  } else if (f.media === 'image') {
    where.push(`JSON_LENGTH(r.media_urls) > 0 AND COALESCE(JSON_LENGTH(r.video_urls), 0) = 0`);
  }
  // 时长 buckets unify text and video. An item passes when EITHER:
  //   - it has a video duration that falls inside the bucket (minSec…maxSec)
  //   - it has NO video AND its text length falls inside the bucket (min…max)
  // Without the video branch, X video posts (content ≈ 20 chars) never made
  // it into any bucket and the "深度长文" / "深度长视频" tab was empty.
  if (f.length) {
    const b = LENGTH_BUCKETS[f.length];
    const branches: string[] = [];
    // Video branch
    let vBranch = `(i.duration_sec IS NOT NULL AND i.duration_sec >= $${p++}`;
    params.push(b.minSec);
    if (b.maxSec != null) {
      vBranch += ` AND i.duration_sec < $${p++}`;
      params.push(b.maxSec);
    }
    vBranch += ')';
    branches.push(vBranch);
    // Text branch (only when there's no video to fall back to)
    let tBranch = `(i.duration_sec IS NULL AND CHAR_LENGTH(COALESCE(i.content, '')) >= $${p++}`;
    params.push(b.min);
    if (b.max != null) {
      tBranch += ` AND CHAR_LENGTH(COALESCE(i.content, '')) < $${p++}`;
      params.push(b.max);
    }
    tBranch += ')';
    branches.push(tBranch);
    where.push(`(${branches.join(' OR ')})`);
  }
  if (f.date && DATE_BUCKETS[f.date].days != null) {
    where.push(`i.published_at >= DATE_SUB(NOW(), INTERVAL $${p++} DAY)`);
    params.push(DATE_BUCKETS[f.date].days);
  }

  // X-style "为你推荐" 排序公式 — HN 衰减 + 互动加权 + 媒体质量
  //
  //   hot_score = (pv_30d * 0.3 + likes * 5 + comments * 3
  //                + video_bonus + image_bonus + 1)
  //               / POW(age_hours + 2, 1.2)
  //
  // 互动权重:
  //   - pv_30d  * 0.3 — 被动浏览,信号弱
  //   - likes   * 5   — 主动点赞,强信号
  //   - comments* 3   — 评论需投入,强情感
  // 媒体质量(冷启动期最重要):
  //   - has_video → +2  视频内容默认价值高于纯图片
  //   - has_image → +0.5 有图比无图好,但远低于视频
  //   - 没有这两项时,新部署 / 零互动数据集里 hot 排序会退化成 latest,
  //     用户看 "为你推荐" tab 和 "最新" tab 数据一样 —— 媒体奖励让公式
  //     在冷启动期就能产生有意义的差异(同时间的视频压过图片)。
  // 时间衰减:
  //   - gravity 1.2 (而非 HN 标准 1.5) — 让 likes / 视频 bonus 有机会
  //     战胜年龄差。1.5 太陡: 一个 24h 老视频比 4h 新图片得分还低,
  //     完全和 latest 重合。1.2 让一个有视频的 12h 老帖 ≈ 一个图片 4h 新帖。
  //   - +2 偏移防止 age=0 时除零爆炸
  // 注意:不能写 `i.comment_count`,那是同层 SELECT 别名,MySQL 拒绝;
  // 也不能直接拼 `i.has_video`/`i.has_image`,它们也是别名 —— 用底层
  // JSON_LENGTH(r.video_urls) > 0 表达式。`r` 是 raw_items 别名,由
  // ARTICLE_FROM 注入,getFiltered 的 JOIN 一定有它。
  const hotScore = `(`
    + `(i.pv_30d * 0.3 + i.likes * 5 + ${COMMENT_COUNT_EXPR} * 3`
    + ` + CASE WHEN JSON_LENGTH(r.video_urls) > 0 THEN 2 ELSE 0 END`
    + ` + CASE WHEN JSON_LENGTH(r.media_urls) > 0 THEN 0.5 ELSE 0 END`
    + ` + 1)`
    + ` / POW(TIMESTAMPDIFF(HOUR, i.published_at, NOW()) + 2, 1.2))`;
  const orderBy = f.sort === 'hot'
    ? `${hotScore} DESC, i.published_at DESC`
    : 'i.published_at DESC';

  const whereSql = where.join(' AND ');

  // Dedup-by-title: 同源博主常用同一句固定标题(如 "Chudai#反差")发不同的
  // 推文,数据库层面是不同 raw_items + 不同 cover,但卡片网格里看着像
  // 重复。用 ROW_NUMBER() OVER (PARTITION BY title) 保留每个标题分组里
  // 当前排序下排名第一的那条,空标题用 id 兜底(保证每条都通过)。
  const dedupKey = `COALESCE(NULLIF(TRIM(i.title), ''), CAST(i.id AS CHAR))`;
  const outerOrderBy = f.sort === 'hot'
    ? 't.hot_score DESC, t.published_at DESC'
    : 't.published_at DESC';

  const [items, totalRows] = await Promise.all([
    query<ArticleCardRow>(
      `SELECT t.id, t.slug, t.title, t.summary, t.source_id,
              t.cover_url, t.cover_sizes, t.category, t.tags,
              t.published_at, t.duration_sec, t.source, t.source_platform, t.source_avatar, t.source_handle,
              t.cover_fallback, t.video_url,
              t.has_video, t.has_image, t.content_length, t.pv_30d, t.likes, t.comment_count
       FROM (
         SELECT ${ARTICLE_COLS},
                ${hotScore} AS hot_score,
                ROW_NUMBER() OVER (
                  PARTITION BY ${dedupKey}
                  ORDER BY ${orderBy}
                ) AS dedup_rn
         ${ARTICLE_FROM}
         WHERE ${whereSql}
       ) t
       WHERE t.dedup_rn = 1
       ORDER BY ${outerOrderBy}
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    ),
    query<{ n: number }>(
      `SELECT COUNT(DISTINCT ${dedupKey}) AS n
       ${ARTICLE_FROM}
       WHERE ${whereSql}`,
      params,
    ),
  ]);

  return { items: items.map(normalize), total: Number(totalRows[0]?.n ?? 0) };
}

/** Full-text search via MySQL ngram parser. Empty q falls back to filter-only. */
export async function search(opts: FeedFilter & { q?: string }): Promise<{ items: ArticleCardRow[]; total: number }> {
  if (!opts.q || !opts.q.trim()) return getFiltered(opts);
  // 搜索缓存 60s — 用户切换 最新/最热 / 翻页时,相同 q 命中 Redis 直返,
  // 避免每次都跑 MATCH AGAINST + ROW_NUMBER 去重子查询(MySQL 上慢)。
  // 60s 足够覆盖一次浏览会话内的来回切换,新发布的内容也能在 1 分钟内到位。
  const q = opts.q.trim();
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const cacheKey = `search:${q.slice(0, 64)}:${opts.sort ?? 'latest'}:${opts.category ?? ''}:${opts.tag ?? ''}:${opts.length ?? ''}:${opts.date ?? ''}:${limit}:${offset}`;
  return cached(cacheKey, 60, () => searchUncached(opts));
}

async function searchUncached(opts: FeedFilter & { q?: string }): Promise<{ items: ArticleCardRow[]; total: number }> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const q = opts.q!.trim();
  const where: string[] = [
    "i.status IN ('PUBLISHED','DISTRIBUTED')",
    'MATCH(i.title, i.summary, i.content) AGAINST ($1 IN NATURAL LANGUAGE MODE)',
  ];
  const params: any[] = [q];
  let p = 2;

  if (opts.category) { where.push(`i.category = $${p++}`); params.push(opts.category); }
  if (opts.tag)      { where.push(`JSON_CONTAINS(i.tags, JSON_QUOTE($${p++}))`);     params.push(opts.tag); }
  if (opts.keyword)  { where.push(`JSON_CONTAINS(i.keywords, JSON_QUOTE($${p++}))`); params.push(opts.keyword); }
  if (opts.length) {
    // Same dual-bucket logic as getFiltered — text OR video duration.
    const b = LENGTH_BUCKETS[opts.length];
    const branches: string[] = [];
    let vBranch = `(i.duration_sec IS NOT NULL AND i.duration_sec >= $${p++}`;
    params.push(b.minSec);
    if (b.maxSec != null) { vBranch += ` AND i.duration_sec < $${p++}`; params.push(b.maxSec); }
    vBranch += ')';
    branches.push(vBranch);
    let tBranch = `(i.duration_sec IS NULL AND CHAR_LENGTH(COALESCE(i.content, '')) >= $${p++}`;
    params.push(b.min);
    if (b.max != null) { tBranch += ` AND CHAR_LENGTH(COALESCE(i.content, '')) < $${p++}`; params.push(b.max); }
    tBranch += ')';
    branches.push(tBranch);
    where.push(`(${branches.join(' OR ')})`);
  }
  if (opts.date && DATE_BUCKETS[opts.date].days != null) {
    where.push(`i.published_at >= DATE_SUB(NOW(), INTERVAL $${p++} DAY)`);
    params.push(DATE_BUCKETS[opts.date].days);
  }
  const whereSql = where.join(' AND ');

  // Title-level dedup mirroring getFiltered — same query keeps showing the
  // same "Chudai#反差" 4 times under /search?q=Chudai otherwise. PARTITION
  // by trimmed title (id fallback for blanks) and pick the highest-relevance
  // row in each group.
  const dedupKey = `COALESCE(NULLIF(TRIM(i.title), ''), CAST(i.id AS CHAR))`;

  const [items, totalRows] = await Promise.all([
    query<ArticleCardRow>(
      `SELECT t.id, t.slug, t.title, t.summary, t.source_id,
              t.cover_url, t.cover_sizes, t.category, t.tags,
              t.published_at, t.duration_sec, t.source, t.source_platform, t.source_avatar, t.source_handle,
              t.cover_fallback, t.video_url,
              t.has_video, t.has_image, t.content_length, t.pv_30d, t.likes, t.comment_count
       FROM (
         SELECT ${ARTICLE_COLS},
                MATCH(i.title, i.summary, i.content) AGAINST ($1 IN NATURAL LANGUAGE MODE) AS rel,
                ROW_NUMBER() OVER (
                  PARTITION BY ${dedupKey}
                  ORDER BY MATCH(i.title, i.summary, i.content) AGAINST ($1 IN NATURAL LANGUAGE MODE) DESC
                ) AS dedup_rn
         ${ARTICLE_FROM}
         WHERE ${whereSql}
       ) t
       WHERE t.dedup_rn = 1
       ORDER BY t.rel DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    ),
    query<{ n: number }>(
      `SELECT COUNT(DISTINCT ${dedupKey}) AS n ${ARTICLE_FROM}
       WHERE ${whereSql}`,
      params,
    ),
  ]);

  return { items: items.map(normalize), total: Number(totalRows[0]?.n ?? 0) };
}

/** Top tags across all PUBLISHED articles. Uses JSON_TABLE to unnest items.tags.
 *  Skip empty/whitespace tags — classify-title's tokenizer occasionally emits
 *  "" (e.g. leading split before a "#"), and an empty tag → empty slug →
 *  generateStaticParams produces "/tag" which breaks `next build` with an
 *  export-path-mismatch against the `/tag/[slug]` route. */
export async function getTopTags(limit = 30): Promise<TagCount[]> {
  // JSON_TABLE full-table-scans items every call. This is the single hottest
  // SSR query (loaded by /tag, /sitemap.xml, footer TagCloud) so caching has
  // an outsized impact once the corpus grows past a few thousand articles.
  return cached(`tags:${limit}`, HOT_TTL, async () => {
    // Pull 3× the requested limit so the post-filter (drops LLM-artifact tags
    // + sentence-length junk) still yields a full `limit` count of clean
    // entries. Cheaper than re-running the JSON_TABLE scan after a miss.
    const rows = await query<TagCount>(
      // CHARACTER SET utf8mb4 on the JSON_TABLE column is load-bearing —
      // without it the connection's session charset can silently coerce
      // non-ASCII (Chinese) tag values to NULL during JSON→VARCHAR extraction.
      `SELECT jt.tag AS tag, COUNT(*) AS count
       FROM items i,
            JSON_TABLE(i.tags, '$[*]' COLUMNS (tag VARCHAR(128) CHARACTER SET utf8mb4 PATH '$')) jt
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND jt.tag IS NOT NULL AND TRIM(jt.tag) <> ''
       GROUP BY jt.tag
       ORDER BY count DESC
       LIMIT $1`,
      [limit * 3],
    );
    // 1) 过滤 LLM-artifact / 句子长度 / URL 形态的 junk 标签
    // 2) 剥掉前缀 # / ＃ — 某些 X / 中文社区把 hash 符当成 tag 字面一部分写进 DB,
    //    显示时不该带它(右栏 / 详情 / search / tag 索引四处统一)
    // 3) 同名合并:`日本` 和 `＃日本` 应该是同一个标签,count 累加
    const merged = new Map<string, number>();
    for (const r of rows) {
      if (isJunkTag(r.tag)) continue;
      const clean = r.tag.replace(/^[#＃]+/, '').trim();
      if (!clean) continue;
      merged.set(clean, (merged.get(clean) ?? 0) + Number(r.count));
    }
    return [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  });
}

/** 右侧 rail 推荐采集源 — 按已发布文章数倒序。
 *  X.com 风格的 "Who to follow" 块,但我们这里展示数据采集源。
 *  缓存窗口和 tags 一致(60s 起步),源列表的变化频率比标签还要低。 */
export interface SourceCount {
  id: string;
  name: string;
  platform: string;
  external_id: string;
  avatar_url: string | null;
  article_count: number;
}
export async function getTopSources(limit = 5): Promise<SourceCount[]> {
  return cached(`sources:${limit}`, HOT_TTL, async () => {
    const rows = await query<{ id: string; name: string; platform: string; external_id: string; avatar_url: string | null; article_count: number }>(
      // 排除 admin-manual-post.ts 自动建的 "手工录入" 兜底源 — 运营手工发帖时
      // 没指定发帖人会归到这条上,在公开推荐栏出现一个名字叫"手工录入"的"博主"
      // 视觉很怪。手工源里运营显式建的(不同 external_id)正常出现。
      // external_id:用来给 virtualBlogger 算真实 @handle(X 上 = screen_name)。
      `SELECT s.id, COALESCE(s.display_name, s.name) AS name, s.platform, s.external_id, s.avatar_url, COUNT(i.id) AS article_count
       FROM sources s
       JOIN items i ON i.source_id = s.id
        AND i.status IN ('PUBLISHED','DISTRIBUTED')
       WHERE s.status = 'active'
         AND NOT (s.platform = 'manual' AND s.external_id = 'manual-posts')
       GROUP BY s.id
       ORDER BY article_count DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ ...r, article_count: Number(r.article_count) }));
  });
}

/** /bloggers 发现页用 — 支持搜索 / 排序 / 分页。
 *  和 getTopSources 不同:这里 LEFT JOIN items,即使博主一篇还没发也能出现
 *  (article_count=0),配合"最新加入"tab。 */
export interface SourceDetail {
  id: string;
  name: string;
  platform: string;
  external_id: string;
  avatar_url: string | null;
  article_count: number;
  last_article_at: string | null;
  created_at: string;
}
export async function searchSources(opts: {
  q?: string;
  sort?: 'popular' | 'newest' | 'recent-active';
  limit?: number;
  offset?: number;
}): Promise<{ sources: SourceDetail[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sort = opts.sort ?? 'popular';
  // 走 Redis 缓存 — /bloggers 列表是高频读 + 低写入,GROUP BY + LEFT JOIN 没必要
  // 每次回源。手工源新建 / 显示名更新都不需要即时反映在列表里。
  const cacheKey = `bloggers:${sort}:${(opts.q ?? '').slice(0, 64)}:${limit}:${offset}`;
  return cached(cacheKey, HOT_TTL, () => searchSourcesUncached(opts));
}

async function searchSourcesUncached(opts: {
  q?: string;
  sort?: 'popular' | 'newest' | 'recent-active';
  limit?: number;
  offset?: number;
}): Promise<{ sources: SourceDetail[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sort = opts.sort ?? 'popular';
  // 同 getTopSources: 排除 admin-manual-post 自动建的"手工录入"兜底源。
  const where: string[] = [
    `s.status = 'active'`,
    `NOT (s.platform = 'manual' AND s.external_id = 'manual-posts')`,
  ];
  const params: unknown[] = [];
  let p = 1;
  if (opts.q && opts.q.trim()) {
    // 长字符串 LIKE 没意义还拖慢全表扫,截到 64 字符够覆盖博主名场景。
    // display_name 优先匹配(X 上的真实显示名), 退化匹配 name(@handle)。
    params.push(`%${opts.q.trim().slice(0, 64)}%`);
    where.push(`COALESCE(s.display_name, s.name) LIKE $${p++}`);
  }
  const whereSql = where.join(' AND ');

  // popular: 按发帖数倒序;newest: 按 source 创建时间倒序;
  // recent-active: 按最近一篇文章时间倒序(沉睡博主排到后面)
  const orderBy =
    sort === 'newest' ? 's.created_at DESC'
    : sort === 'recent-active' ? 'last_article_at DESC, article_count DESC'
    : 'article_count DESC, s.created_at DESC';

  const [rows, totalRows] = await Promise.all([
    query<{
      id: string; name: string; platform: string; external_id: string; avatar_url: string | null;
      article_count: number; last_article_at: string | null; created_at: string;
    }>(
      `SELECT s.id, COALESCE(s.display_name, s.name) AS name, s.platform, s.external_id, s.avatar_url, s.created_at,
              COUNT(i.id) AS article_count,
              MAX(i.published_at) AS last_article_at
       FROM sources s
       LEFT JOIN items i ON i.source_id = s.id AND i.status IN ('PUBLISHED','DISTRIBUTED')
       WHERE ${whereSql}
       GROUP BY s.id
       ORDER BY ${orderBy}
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sources s WHERE ${whereSql}`,
      params,
    ),
  ]);

  // mysql2 把 MAX(TIMESTAMP) 和 s.created_at 返成 JS Date 对象;SourceDetail 类型
  // 是 string,React 渲染 / formatTimeAgo 会 hydration mismatch。统一拍扁 ISO 串。
  const toISO = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  return {
    sources: rows.map((r) => ({
      ...r,
      article_count: Number(r.article_count),
      last_article_at: toISO(r.last_article_at),
      created_at: toISO(r.created_at) ?? '',
    })),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/** Resolve an article slug → row + related (same category, excluding self).
 *  When `media` is passed, also constrains to articles of the same media
 *  kind (video or image-only) so the "相关推荐" strip on a video page only
 *  surfaces other videos, and the image page only surfaces other images.
 *  Falls back to the unconstrained set if the strict match returns nothing
 *  — a sparse category shouldn't render an empty section.
 *
 *  Cached per-article: every detail-page render asks for this strip and the
 *  computation is identical across views of the same article. Key includes
 *  excludeId + media so neighboring articles don't poison each other and the
 *  two media flavours don't cross-contaminate. */
export async function getRelated(
  category: string | null,
  excludeId: string,
  limit = 6,
  media?: 'video' | 'image',
): Promise<ArticleCardRow[]> {
  if (!category) return [];
  // cache key 故意不带 excludeId — 否则每篇文章一个 key, Redis 键基数无界。
  // 取 limit+1 条候选(SQL 里不 exclude), 拿到后在内存里过滤掉当前文章 id,
  // 再 slice 到 limit。同 category × 同 media 的所有文章共享一份缓存。
  const fetchLimit = limit + 1;
  return cached(`rel:${category}:${media ?? 'any'}:${fetchLimit}`, HOT_TTL, async () => {
    const mediaCond = media === 'video'
      ? 'AND JSON_LENGTH(r.video_urls) > 0'
      : media === 'image'
      ? 'AND JSON_LENGTH(r.media_urls) > 0 AND COALESCE(JSON_LENGTH(r.video_urls), 0) = 0'
      : '';
    // 跟 getFilteredUncached / search() 同款的 title-level 去重 —
    // 同一推文多次入库(carousel / 重爬)时,标题相同的多条 row 只保留 published_at
    // 最新的一条。否则 "相关推荐" 出现两张几乎一样的卡片。
    const dedupKey = `COALESCE(NULLIF(TRIM(i.title), ''), CAST(i.id AS CHAR))`;
    const rows = await query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       FROM (
         SELECT i.*,
                ROW_NUMBER() OVER (PARTITION BY ${dedupKey} ORDER BY i.published_at DESC) AS dedup_rn
         FROM items i
         WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND i.category = $1
       ) i
       JOIN sources s ON s.id = i.source_id
       LEFT JOIN raw_items r ON r.id = i.raw_item_id
       WHERE i.dedup_rn = 1 ${mediaCond}
       ORDER BY i.published_at DESC
       LIMIT $2`,
      [category, fetchLimit],
    );
    // Fallback 同样去重 + 不带 exclude — 否则丢分类约束后更容易撞标题。
    if (rows.length === 0 && media) {
      const fallback = await query<ArticleCardRow>(
        `SELECT ${ARTICLE_COLS}
         FROM (
           SELECT i.*,
                  ROW_NUMBER() OVER (PARTITION BY ${dedupKey} ORDER BY i.published_at DESC) AS dedup_rn
           FROM items i
           WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
         ) i
         JOIN sources s ON s.id = i.source_id
         LEFT JOIN raw_items r ON r.id = i.raw_item_id
         WHERE i.dedup_rn = 1 ${mediaCond}
         ORDER BY i.published_at DESC
         LIMIT $1`,
        [fetchLimit],
      );
      return fallback.map(normalize);
    }
    return rows.map(normalize);
  }).then((rows) => rows.filter((r) => r.id !== excludeId).slice(0, limit));
}

/** "更多来自该博主" — X profile 风格的同作者卡片流。
 *  按发布时间倒序,排除当前文章。和 getRelated 的"同类目"维度互补 —
 *  文章详情页同时展示两者,读者既能横向(同主题)也能纵向(同作者)继续刷。
 *  缓存 60s 跟其他 feed 一致。 */
export async function getMoreFromAuthor(
  sourceId: string,
  excludeId: string,
  limit = 6,
): Promise<ArticleCardRow[]> {
  // 同 getRelated:cache key 不带 excludeId, 取 limit+1 在内存过滤当前 id。
  const fetchLimit = limit + 1;
  return cached(`author:${sourceId}:${fetchLimit}`, HOT_TTL, async () => {
    // 同标题只保留最新一条 — 跟 getRelated 一致, 防博主重发 / 同推文多次入库。
    const dedupKey = `COALESCE(NULLIF(TRIM(i.title), ''), CAST(i.id AS CHAR))`;
    const rows = await query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       FROM (
         SELECT i.*,
                ROW_NUMBER() OVER (PARTITION BY ${dedupKey} ORDER BY i.published_at DESC) AS dedup_rn
         FROM items i
         WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND i.source_id = $1
       ) i
       JOIN sources s ON s.id = i.source_id
       LEFT JOIN raw_items r ON r.id = i.raw_item_id
       WHERE i.dedup_rn = 1
       ORDER BY i.published_at DESC
       LIMIT $2`,
      [sourceId, fetchLimit],
    );
    return rows.map(normalize);
  }).then((rows) => rows.filter((r) => r.id !== excludeId).slice(0, limit));
}

function normalize(r: any): ArticleCardRow {
  // mysql2 returns JSON columns as already-parsed JS values. Defensive parse
  // in case the driver hands back a string for some envs.
  const rawTags = parseJson<string[]>(r.tags) ?? [];
  // Drop LLM-artifact tags ("关键词《X》"), sentence-length tags, and any tag
  // that's actually a URL/@handle. Filtering at the read layer means every
  // surface — listing cards, article page chips, <meta keywords>, JSON-LD —
  // gets the same clean array without remembering to filter at each call site.
  const tags = cleanTagList(rawTags);
  const cover_sizes = parseJson<Record<string, string>>(r.cover_sizes) ?? null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    cover_url: r.cover_url,
    cover_sizes,
    cover_fallback: r.cover_fallback ?? null,
    source_id: r.source_id ?? null,
    // mysql2 returns the boolean expressions as 1/0; coerce to real booleans
    // so the JSX can use them in `&&` without rendering "0".
    has_video: Boolean(Number(r.has_video ?? 0)),
    has_image: Boolean(Number(r.has_image ?? 0)),
    video_url: r.video_url ?? null,
    duration_sec: r.duration_sec != null ? Number(r.duration_sec) : null,
    category: r.category,
    tags,
    // mysql2 把 TIMESTAMP/DATETIME 返成 Date 对象;ArticleCardRow 类型声明是 string,
    // React 渲染 dateTime / formatTimeAgo 比对会 hydration mismatch。统一拍扁 ISO 串。
    published_at: r.published_at
      ? (typeof r.published_at === 'string' ? r.published_at : new Date(r.published_at).toISOString())
      : null,
    source: r.source ?? null,
    source_platform: r.source_platform ?? null,
    source_avatar: r.source_avatar ?? null,
    source_handle: r.source_handle ?? null,
    comment_count: Number(r.comment_count ?? 0),
    content_length: Number(r.content_length ?? 0),
    likes: Number(r.likes ?? 0),
    pv_30d: Number(r.pv_30d ?? 0),
  };
}

function parseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

/** Estimated read minutes from char count (~200 zh chars/min). */
export function readMinutes(charCount: number): number {
  return Math.max(1, Math.round(charCount / 200));
}
