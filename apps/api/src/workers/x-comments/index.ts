/**
 * X 评论同步 worker。
 *
 * fanout 选条件:
 *   - status IN (PUBLISHED, DISTRIBUTED)
 *   - source.platform = 'x'
 *   - raw_payload.extra.tweetId IS NOT NULL
 *   - comments_synced_at IS NULL OR < NOW() - 10min(冷却窗口)
 *
 * 不再用"近 7 天"热门窗口 — 用户要求所有抓取到的帖都同步。冷却 + batch(30)
 * 仍保留,避免一轮把 X 打挂触发限流。NULL 优先(从没同步过)+ 老的 synced_at
 * 优先(冷掉最久的先轮),保证 backlog 均匀消化。
 *
 * 对每个 item:
 *   1. 调 fetchTweetReplies(source, tweetId) 拿 X 回复
 *   2. 用 ad-filter checkAd 过滤广告 / 引流
 *   3. UPSERT external_comments(unique on platform + external_id)
 *   4. 更新 items.comments_synced_at = NOW()
 *
 * cooldown(10 分钟)在 SQL where 里用,不存到 Redis;worker 单实例无并发竞争。
 * 失败 / X 鉴权挂掉走 best-effort,不影响其它 item。
 */
import type { Job } from 'bullmq';
import { QUEUE_NAMES, startWorker, withRun, getQueue } from '@ch/agents';
import { query, execute } from '@ch/db';
import { fetchTweetReplies } from '../ingestion/adapters/x.js';
import { AdapterAuthError, type SourceRow } from '../ingestion/adapters/types.js';
import { checkAd } from '../ingestion/ad-filter.js';

export interface XCommentsJob {
  kind: 'fanout' | 'sync-one';
  /** sync-one 时指定 */
  itemId?: string;
}

const COOLDOWN_MINUTES = 10;
const BATCH_PER_TICK   = 30;

interface CandidateRow {
  item_id: string;
  source_id: string;
  tweet_id: string;
  raw_payload: any;
}

async function pickCandidates(limit: number): Promise<CandidateRow[]> {
  // 用 raw_items.raw_payload 里的 extra.tweetId 当 X tweet 锚点。
  // 这是 ingestion 阶段 tweetToCandidate 写入的字段。
  return query<CandidateRow>(
    `SELECT i.id AS item_id, i.source_id,
            JSON_UNQUOTE(JSON_EXTRACT(r.raw_payload, '$.extra.tweetId')) AS tweet_id,
            r.raw_payload AS raw_payload
     FROM items i
     JOIN raw_items r ON r.id = i.raw_item_id
     JOIN sources s   ON s.id = i.source_id
     WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
       AND s.platform = 'x'
       AND (i.comments_synced_at IS NULL
            OR i.comments_synced_at < NOW() - INTERVAL ${COOLDOWN_MINUTES} MINUTE)
       AND JSON_UNQUOTE(JSON_EXTRACT(r.raw_payload, '$.extra.tweetId')) IS NOT NULL
     ORDER BY i.comments_synced_at IS NULL DESC, i.comments_synced_at ASC
     LIMIT $1`,
    [limit],
  );
}

async function loadSource(sourceId: string): Promise<SourceRow | null> {
  const rows = await query<SourceRow>(
    `SELECT id, platform, external_id, name, url, config, credential_id
     FROM sources WHERE id = $1 LIMIT 1`,
    [sourceId],
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    // mysql2 已经把 JSON 列 parse 好;万一返回 string 防御性 parse
    config: typeof rows[0].config === 'string'
      ? JSON.parse(rows[0].config as unknown as string)
      : rows[0].config,
  };
}

async function syncOneItem(cand: CandidateRow): Promise<{ fetched: number; inserted: number; filtered: number; authFail?: boolean }> {
  const source = await loadSource(cand.source_id);
  if (!source) return { fetched: 0, inserted: 0, filtered: 0 };

  let thread;
  try {
    thread = await fetchTweetReplies(source, cand.tweet_id, { limit: 50 });
  } catch (e: any) {
    if (e instanceof AdapterAuthError) {
      console.warn(`[x-comments] tweet=${cand.tweet_id} auth fail status=${e.status}: ${e.reason}`);
      // 标记本条已尝试过,避免 cooldown 内反复挂
      await touchSynced(cand.item_id);
      return { fetched: 0, inserted: 0, filtered: 0, authFail: true };
    }
    console.warn(`[x-comments] tweet=${cand.tweet_id} fetch err: ${e?.message ?? e}`);
    await touchSynced(cand.item_id);
    return { fetched: 0, inserted: 0, filtered: 0 };
  }

  // 顺手同步 X 推文当前的累计查看数 — items.external_views 跟 pv_30d 相加
  // 之后作为列表卡 👁️ 显示。仅在 X 返回有效 view_count 时更新,空 / 不变值不写。
  if (thread.focalViewCount != null && thread.focalViewCount > 0) {
    await execute(
      `UPDATE items SET external_views = $2
       WHERE id = $1 AND COALESCE(external_views, 0) <> $2`,
      [cand.item_id, thread.focalViewCount],
    );
  }

  let filtered = 0;
  let inserted = 0;
  for (const r of thread.replies) {
    const ad = checkAd(r.body);
    if (ad.isAd) { filtered++; continue; }

    // UPSERT — UNIQUE(platform, external_id) 保证复爬幂等;同一条回复被改
    // (X 允许编辑 30s 内的推文)只更新 body 和 synced_at。
    const res = await execute(
      `INSERT INTO external_comments
         (item_id, platform, external_id, author_handle, author_name, author_avatar, body, posted_at)
       VALUES ($1, 'x', $2, $3, $4, $5, $6, $7)
       ON DUPLICATE KEY UPDATE
         body          = VALUES(body),
         author_name   = VALUES(author_name),
         author_avatar = VALUES(author_avatar),
         synced_at     = CURRENT_TIMESTAMP`,
      [cand.item_id, r.tweetId, r.authorHandle, r.authorName, r.authorAvatar, r.body, r.postedAt],
    );
    // affectedRows: 1 = insert, 2 = update under MySQL semantics. 0 也算同步过。
    if ((res.affectedRows ?? 0) > 0) inserted++;
  }

  // 重算物化的 items.comment_count(本站匿名 + X 同步两表合计)。
  // 用 SELECT...UPDATE 而不是增量 +N — UPSERT 复爬同条评论不算新增, 增量会失真;
  // 单条 item 重算开销 ~ms,可接受。
  await execute(
    `UPDATE items SET comment_count =
       COALESCE((SELECT COUNT(*) FROM comments c WHERE c.item_id = items.id), 0)
       + COALESCE((SELECT COUNT(*) FROM external_comments ec WHERE ec.item_id = items.id), 0)
     WHERE items.id = $1`,
    [cand.item_id],
  );

  await touchSynced(cand.item_id);
  return { fetched: thread.replies.length, inserted, filtered };
}

async function touchSynced(itemId: string): Promise<void> {
  await execute(`UPDATE items SET comments_synced_at = NOW() WHERE id = $1`, [itemId]);
}

async function runFanout(): Promise<{ candidates: number; synced: number; inserted: number; filtered: number; authFail: number }> {
  const cands = await pickCandidates(BATCH_PER_TICK);
  let synced = 0, inserted = 0, filtered = 0, authFail = 0;
  for (const c of cands) {
    const out = await syncOneItem(c);
    synced++;
    inserted += out.inserted;
    filtered += out.filtered;
    if (out.authFail) authFail++;
  }
  return { candidates: cands.length, synced, inserted, filtered, authFail };
}

export function startXCommentsWorker() {
  // 启动后挂个 10 分钟一次的 fanout job — BullMQ repeatable job 是幂等的,
  // 重启进程不会重复挂。
  const q = getQueue<XCommentsJob>(QUEUE_NAMES.xComments);
  q.add(
    'fanout',
    { kind: 'fanout' },
    {
      jobId: 'x-comments-fanout-repeat',
      repeat: { every: COOLDOWN_MINUTES * 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  ).catch((e) => console.warn('[x-comments] failed to schedule fanout:', e?.message ?? e));

  return startWorker<XCommentsJob>(
    QUEUE_NAMES.xComments,
    async (job: Job<XCommentsJob>) => {
      const kind = job.data?.kind ?? 'fanout';
      if (kind === 'sync-one') {
        if (!job.data?.itemId) return { output: { error: 'itemId required' } };
        return withRun<Record<string, unknown>>({ agent: 'x-comments:sync-one' }, async () => {
          const rows = await query<CandidateRow>(
            `SELECT i.id AS item_id, i.source_id,
                    JSON_UNQUOTE(JSON_EXTRACT(r.raw_payload, '$.extra.tweetId')) AS tweet_id,
                    r.raw_payload AS raw_payload
             FROM items i JOIN raw_items r ON r.id = i.raw_item_id
             WHERE i.id = $1 LIMIT 1`,
            [job.data.itemId],
          );
          if (!rows[0] || !rows[0].tweet_id) return { output: { skipped: true } };
          const out = await syncOneItem(rows[0]);
          return { output: { ...out } };
        });
      }
      return withRun<Record<string, unknown>>({ agent: 'x-comments:fanout' }, async () => {
        const out = await runFanout();
        return { output: { ...out } };
      });
    },
    // concurrency=1: 单 worker 串行;每条 item 调一次 X TweetDetail(~500-1000ms),
    // batch 30 条 fanout 总耗时 15-30s 偶尔会跨 60s。
    // lockDuration=5 分钟给充足续约窗口, 否则默认 30s 经常贴边触发 "could not renew lock"。
    // stalledInterval 同步拉大, 别在 fanout 中段误判 stalled。
    { concurrency: 1, lockDuration: 5 * 60_000, stalledInterval: 5 * 60_000 },
  );
}
