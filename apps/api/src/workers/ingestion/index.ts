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
  urlAlreadySeen,
  contentAlreadySeenForSource,
  nearestSimhash,
} from './dedupe.js';
import { persistIngested } from './persist.js';

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
  if (!source) throw new Error(`source ${sourceId} not found or inactive`);

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

  for (const c of candidates) {
    try {
      const key = makeDedupeKey(source.platform, c.externalId);
      if (await urlAlreadySeen(source.id, key)) {
        stats.dupUrl++;
        continue;
      }
      // Adapters that can't get a real article page (e.g. Google News SPA
      // redirects) may supply plain `text` directly. In that case we skip
      // Readability and build a minimal Cleaned struct from adapter output.
      let cleaned: ReturnType<typeof clean> | null;
      if (c.text && c.text.length >= 20) {
        cleaned = {
          title: c.title ?? null,
          excerpt: c.text.slice(0, 220),
          content: c.text,
          contentHtml: `<p>${c.text}</p>`,
          mediaUrls: c.mediaUrls ?? [],
          length: c.text.length,
        };
      } else {
        if (!c.html) {
          stats.cleanFail++;
          continue;
        }
        cleaned = clean(c.html, c.url);
        if (!cleaned || cleaned.length < 200) {
          stats.cleanFail++;
          continue;
        }
      }

      const contentHash = sha256(normalizeForHash(cleaned.content));
      if (await contentAlreadySeenForSource(source.id, contentHash)) {
        stats.dupContent++;
        continue;
      }
      const fp = simhash(cleaned.content);
      if (!c.skipSimhash) {
        const nearest = await nearestSimhash(source.id, fp);
        if (nearest && nearest.distance <= SIMHASH_THRESHOLD) {
          stats.dupContent++;
          continue;
        }
      }

      const persisted = await persistIngested({
        sourceId: source.id,
        url: c.url,
        fetchedAt: c.publishedAt ?? new Date(),
        rawPayload: { title: c.title, extra: c.extra, htmlBytes: c.html?.length ?? 0 },
        mediaUrls: cleaned.mediaUrls,
        contentHash,
        dedupeKey: key,
        simhash: fp,
        title: cleaned.title ?? c.title ?? null,
        summary: cleaned.excerpt,
        content: cleaned.content,
        contentHtml: cleaned.contentHtml,
      });
      stats.ingested++;

      // Hand off to the Classify+Title Agent. jobId dedupes retries.
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: persisted.itemId },
        { jobId: `classify-title__${persisted.itemId}` },
      );
    } catch (e: any) {
      // 23505 = unique_violation (dedupe_key race from concurrent fetches)
      if (e?.code === '23505') {
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
