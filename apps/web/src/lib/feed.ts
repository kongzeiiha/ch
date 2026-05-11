import { query } from './db';
import { cached } from './cache';
import { cleanTagList, isJunkTag } from './strip-urls';

// TTL for hot reads. 60s is the sweet spot: tags / hot / trending change at
// most every few minutes (a publish or a rollback). One minute of stale tag
// cloud is invisible to humans and saves orders of magnitude on JSON_TABLE
// full scans once the corpus grows. Tuned via env so ops can drop this for
// incident debugging without a code change.
const HOT_TTL = Number(process.env.FEED_CACHE_TTL ?? 60);

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
  category: string | null;
  tags: string[];
  published_at: string | null;
  source: string | null;
  /** content character count, used for the 时长 bucket */
  content_length: number;
}

export interface TagCount { tag: string; count: number }

// Items joined to their raw counterpart so we can fall back to the first
// raw media URL when the cover agent hasn't generated a cover_url yet.
// `cover_fallback` is routed through /img-proxy on render to handle X CDN
// hot-link protection — same path as the article detail gallery uses.
const ARTICLE_COLS = `
  i.id, i.slug, i.title, i.summary, i.source_id,
  i.cover_url, i.cover_sizes, i.category, i.tags,
  i.published_at,
  s.name AS source,
  JSON_UNQUOTE(JSON_EXTRACT(r.media_urls, '$[0]')) AS cover_fallback,
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
    const rows = await query<ArticleCardRow & { pv: number }>(
      `SELECT ${ARTICLE_COLS},
              COALESCE(SUM(a.pv), 0) AS pv
       ${ARTICLE_FROM}
       LEFT JOIN analytics_daily a
         ON a.item_id = i.id
        AND a.date >= DATE_SUB(CURDATE(), INTERVAL $1 DAY)
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
       GROUP BY i.id
       ORDER BY pv DESC, i.published_at DESC
       LIMIT $2`,
      [days, limit],
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

/** Length bucket used by category/search filters. Boundaries derived from
 *  ~200 zh-chars/min reading speed: <1000 ≈ <5 min, 3000 ≈ <15 min. */
export type LengthBucket = 'short' | 'medium' | 'long';
export const LENGTH_BUCKETS: Record<LengthBucket, { min: number; max: number | null; label: string }> = {
  short:  { min: 0,    max: 1000,  label: '短文(<5 分钟)' },
  medium: { min: 1000, max: 3000,  label: '中篇(5-15 分钟)' },
  long:   { min: 3000, max: null,  label: '长文(>15 分钟)' },
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
  /** sort: 'latest' (default) | 'hot' (PV desc) */
  sort?: 'latest' | 'hot';
  limit?: number;
  offset?: number;
}

export async function getFiltered(f: FeedFilter): Promise<{ items: ArticleCardRow[]; total: number }> {
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
  if (f.length) {
    const b = LENGTH_BUCKETS[f.length];
    where.push(`CHAR_LENGTH(COALESCE(i.content, '')) >= $${p++}`); params.push(b.min);
    if (b.max != null) { where.push(`CHAR_LENGTH(COALESCE(i.content, '')) < $${p++}`); params.push(b.max); }
  }
  if (f.date && DATE_BUCKETS[f.date].days != null) {
    where.push(`i.published_at >= DATE_SUB(NOW(), INTERVAL $${p++} DAY)`);
    params.push(DATE_BUCKETS[f.date].days);
  }

  // Hot sort reads the materialized i.pv_30d column (refreshed once per
  // analytics pull). Earlier versions ran a correlated SUM(pv) subquery
  // here, which forced a filesort over every matching row.
  const orderBy = f.sort === 'hot'
    ? 'i.pv_30d DESC, i.published_at DESC'
    : 'i.published_at DESC';

  const whereSql = where.join(' AND ');

  const [items, totalRows] = await Promise.all([
    query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       ${ARTICLE_FROM}
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*) AS n ${ARTICLE_FROM}
       WHERE ${whereSql}`,
      params,
    ),
  ]);

  return { items: items.map(normalize), total: Number(totalRows[0]?.n ?? 0) };
}

/** Full-text search via MySQL ngram parser. Empty q falls back to filter-only. */
export async function search(opts: FeedFilter & { q?: string }): Promise<{ items: ArticleCardRow[]; total: number }> {
  if (!opts.q || !opts.q.trim()) return getFiltered(opts);

  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;
  const q = opts.q.trim();
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
    const b = LENGTH_BUCKETS[opts.length];
    where.push(`CHAR_LENGTH(COALESCE(i.content, '')) >= $${p++}`); params.push(b.min);
    if (b.max != null) { where.push(`CHAR_LENGTH(COALESCE(i.content, '')) < $${p++}`); params.push(b.max); }
  }
  if (opts.date && DATE_BUCKETS[opts.date].days != null) {
    where.push(`i.published_at >= DATE_SUB(NOW(), INTERVAL $${p++} DAY)`);
    params.push(DATE_BUCKETS[opts.date].days);
  }
  const whereSql = where.join(' AND ');

  const [items, totalRows] = await Promise.all([
    query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS},
              MATCH(i.title, i.summary, i.content) AGAINST ($1 IN NATURAL LANGUAGE MODE) AS rel
       ${ARTICLE_FROM}
       WHERE ${whereSql}
       ORDER BY rel DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*) AS n ${ARTICLE_FROM}
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
    return rows
      .filter((r) => !isJunkTag(r.tag))
      .slice(0, limit)
      .map((r) => ({ tag: r.tag, count: Number(r.count) }));
  });
}

/** Resolve an article slug → row + related (same category, excluding self).
 *  Cached per-article: every detail-page render asks for this strip and the
 *  computation is identical across views of the same article. Key includes
 *  excludeId so neighboring articles don't poison each other. */
export async function getRelated(category: string | null, excludeId: string, limit = 6): Promise<ArticleCardRow[]> {
  if (!category) return [];
  return cached(`rel:${category}:${excludeId}:${limit}`, HOT_TTL, async () => {
    const rows = await query<ArticleCardRow>(
      `SELECT ${ARTICLE_COLS}
       ${ARTICLE_FROM}
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND i.category = $1 AND i.id <> $2
       ORDER BY i.published_at DESC
       LIMIT $3`,
      [category, excludeId, limit],
    );
    return rows.map(normalize);
  });
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
    category: r.category,
    tags,
    published_at: r.published_at,
    source: r.source ?? null,
    content_length: Number(r.content_length ?? 0),
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
