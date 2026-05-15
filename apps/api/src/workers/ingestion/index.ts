import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { adapterFor, AdapterAuthError, type SourceRow } from './adapters/index.js';
import { clean } from './clean.js';
import { simhash } from './simhash.js';
import {
  dedupeKey as makeDedupeKey,
  normalizeForHash,
  sha256,
  seenDedupeKeys,
  seenContentHashes,
  loadSimhashes,
  findNearestSimhash,
} from './dedupe.js';
import { persistIngested } from './persist.js';
import { checkAd } from './ad-filter.js';

export type IngestionJob =
  | { kind: 'fanout' }
  | { kind: 'ingest'; sourceId: string };

export interface IngestStats {
  candidates: number;
  ingested: number;
  dupUrl: number;
  dupContent: number;
  cleanFail: number;
  errors: number;
  /** 首条命中广告规则被跳过的计数 */
  adSkipped?: number;
  /** Set when the upstream rejected our credentials. Workbench surfaces this. */
  authFail?: boolean;
  authStatus?: number;
  authReason?: string;
}

const SIMHASH_THRESHOLD = 3; // hamming distance out of 63 bits

export async function ingestSource(sourceId: string): Promise<IngestStats> {
  const rows = await query<SourceRow>(
    `SELECT id, platform, external_id, name, url, config, credential_id
     FROM sources WHERE id = $1 AND status = 'active'`,
    [sourceId],
  );
  const source = rows[0];
  if (!source) {
    // 源被删除或停用后,BullMQ 队列里残留的 in-flight job 进来会落到这里。
    // 不应当 throw —— 那样会触发 BullMQ 重试 + 在 agent_runs 写 failed,
    // 还会拉高 LLM 失败率告警。返回空 stats 让 job 静默成功完成,孤儿
    // 任务自然 drain。
    console.debug(`[ingestion] source ${sourceId} not found or inactive — orphan job acked`);
    return { candidates: 0, ingested: 0, dupUrl: 0, dupContent: 0, cleanFail: 0, errors: 0 };
  }

  const adapter = adapterFor(source.platform);
  let candidates: Awaited<ReturnType<typeof adapter.fetch>> = [];
  let authInfo: Pick<IngestStats, 'authFail' | 'authStatus' | 'authReason'> = {};
  try {
    candidates = await adapter.fetch(source);
  } catch (e: unknown) {
    if (e instanceof AdapterAuthError) {
      authInfo = { authFail: true, authStatus: e.status, authReason: e.reason };
      console.warn(`[ingestion] source=${sourceId} auth-fail status=${e.status}: ${e.reason}`);
    } else {
      throw e;
    }
  }

  const stats: IngestStats = {
    candidates: candidates.length,
    ingested: 0,
    dupUrl: 0,
    dupContent: 0,
    cleanFail: 0,
    errors: 0,
    ...authInfo,
  };

  // ── Batch dedup pre-load (3 queries for the whole candidate set) ──────────
  const allKeys = candidates.map((c) => makeDedupeKey(source.platform, c.externalId));
  const knownKeys = await seenDedupeKeys(source.id, allKeys);

  // Content hashes require cleaning first; pre-compute and filter in two passes.
  // Pass 1: clean all candidates, drop URL dups immediately.
  type Cleaned = ReturnType<typeof clean> & { length: number };
  type CandidateWithHash = { c: typeof candidates[number]; key: string; cleaned: Cleaned; contentHash: string };
  const toHashCheck: CandidateWithHash[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const key = makeDedupeKey(source.platform, c.externalId);
    if (knownKeys.has(key)) { stats.dupUrl++; continue; }

    // 「首条置顶若是广告则过滤掉」规则:
    // candidates[0] 是适配器返回的最顶条(X 上是 pinned tweet 或最新推);
    // 命中广告关键词阈值 → 整条丢弃,不入 raw_items,不入 items,不浪费下游 LLM 配额。
    // 只在 i===0 触发,免得正文里偶尔有"加群"字样的正常帖子也被误杀。
    if (i === 0) {
      const probe = `${c.title ?? ''} ${c.text ?? ''}`;
      const ad = checkAd(probe);
      if (ad.isAd) {
        stats.adSkipped = (stats.adSkipped ?? 0) + 1;
        // 写入 ingestion_ad_skips 表供 /admin/ingestion/ad-skipped 端点查询。
        // 失败不影响主流程(只是日志/可观测性),catch 静默吞掉。
        await query(
          `INSERT INTO ingestion_ad_skips (source_id, item_url, item_title, matched_tokens)
           VALUES ($1, $2, $3, $4)`,
          [source.id, c.url ?? null, (c.title ?? c.text ?? '').slice(0, 1024), JSON.stringify(ad.hits)],
        ).catch((e) => console.warn('[ingestion] ad-skip log failed:', e?.message ?? e));
        console.info(`[ingestion] source=${source.id} 首条命中广告,hits=${ad.hits.join(',')} → 跳过`);
        continue;
      }
    }

    let cleaned: Cleaned | null;
    if (c.text && c.text.length >= 20) {
      const escapedText = c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      cleaned = {
        title: c.title ?? null,
        excerpt: c.text.slice(0, 220),
        content: c.text,
        contentHtml: `<p>${escapedText}</p>`,
        mediaUrls: c.mediaUrls ?? [],
        length: c.text.length,
      };
    } else {
      if (!c.html) { stats.cleanFail++; continue; }
      cleaned = clean(c.html, c.url) as Cleaned | null;
      if (!cleaned || cleaned.length < 200) { stats.cleanFail++; continue; }
    }

    const contentHash = sha256(normalizeForHash(cleaned.content));
    toHashCheck.push({ c, key, cleaned, contentHash });
  }

  // Pass 2: batch content-hash check, then load simhashes once.
  const knownHashes = await seenContentHashes(source.id, toHashCheck.map((x) => x.contentHash));
  const simhashPool = await loadSimhashes(source.id);

  for (const { c, key, cleaned, contentHash } of toHashCheck) {
    try {
      if (knownHashes.has(contentHash)) { stats.dupContent++; continue; }

      const fp = simhash(cleaned.content);
      if (!c.skipSimhash) {
        const nearest = findNearestSimhash(fp, simhashPool);
        if (nearest && nearest.distance <= SIMHASH_THRESHOLD) {
          stats.dupContent++;
          continue;
        }
      }

      // Adapter-specific video extras (currently only X) live in candidate.extra.videoUrls.
      // Pass them through so persist can mirror to MinIO.
      const videoSourceUrls = Array.isArray((c.extra as any)?.videoUrls)
        ? ((c.extra as any).videoUrls as string[])
        : undefined;

      const persisted = await persistIngested({
        sourceId: source.id,
        url: c.url,
        fetchedAt: c.publishedAt ?? new Date(),
        rawPayload: { title: c.title, extra: c.extra, htmlBytes: c.html?.length ?? 0 },
        mediaUrls: cleaned.mediaUrls,
        videoSourceUrls,
        contentHash,
        dedupeKey: key,
        simhash: fp,
        title: cleaned.title ?? c.title ?? null,
        summary: cleaned.excerpt,
        content: cleaned.content,
        contentHtml: cleaned.contentHtml,
      });
      stats.ingested++;

      // Hand off to the Classify+Title Agent. jobId dedupes retries while
      // queued; removeOnComplete:true frees the id on success so the next
      // pipeline rerun (or a re-ingest of an item that was rolled back) isn't
      // silently dropped by BullMQ's dedup against the historical completed
      // job. Same rationale as cover→compliance and compliance→publish.
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: persisted.itemId },
        { jobId: `classify-title__${persisted.itemId}`, removeOnComplete: true },
      );
    } catch (e: any) {
      // 重复主键 = dedupe_key 命中 (并发 fetch 撞同一条 raw_item 是常态,不是 bug)
      //   - PG: SQLSTATE 23505 (unique_violation), 旧迁移前的代码
      //   - MySQL: code 'ER_DUP_ENTRY' (errno 1062), 当前 stack
      // 两种都吞掉、计入 dupUrl,不再误打到 warn 日志。
      const isDup = e?.code === '23505'
        || e?.code === 'ER_DUP_ENTRY'
        || e?.errno === 1062;
      if (isDup) {
        stats.dupUrl++;
      } else {
        stats.errors++;
        console.warn(`[ingestion] ${c.url}: ${e?.message ?? e}`);
      }
    }
  }
  return stats;
}

async function fanout(): Promise<{ enqueued: number; skipped: number }> {
  const sources = await query<{ id: string; grayscale_pct: number }>(
    `SELECT id, COALESCE(grayscale_pct, 100) AS grayscale_pct
     FROM sources WHERE status = 'active'`,
  );
  const q = getQueue<IngestionJob>(QUEUE_NAMES.ingestion);
  let enqueued = 0;
  let skipped = 0;
  for (const s of sources) {
    // grayscale_pct=10 → 10% chance of being picked this cycle
    if (Math.random() * 100 < s.grayscale_pct) {
      await q.add('ingest', { kind: 'ingest', sourceId: s.id });
      enqueued++;
    } else {
      skipped++;
    }
  }
  return { enqueued, skipped };
}

export function startIngestionWorker() {
  return startWorker<IngestionJob>(
    QUEUE_NAMES.ingestion,
    async (job: Job<IngestionJob>) => {
      const data = job.data;
      if (data.kind === 'fanout') {
        return withRun({ agent: 'ingestion:fanout' }, async () => {
          const out = await fanout();
          return { output: out };
        });
      }
      if (data.kind === 'ingest') {
        return withRun(
          { agent: 'ingestion', itemId: null, inputHash: data.sourceId },
          async () => ({ output: await ingestSource(data.sourceId) }),
        );
      }
      throw new Error(`unknown job kind: ${(data as any).kind}`);
    },
    { concurrency: 6 },
  );
}
