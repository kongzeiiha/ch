import { createHash } from 'node:crypto';
import { query } from '@ch/db';
import { hamming } from './simhash.js';

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function dedupeKey(platform: string, externalId: string): string {
  return sha256(`${platform}:${externalId}`);
}

export function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function urlAlreadySeen(sourceId: string, key: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM raw_items WHERE source_id = $1 AND dedupe_key = $2 LIMIT 1',
    [sourceId, key],
  );
  return rows.length > 0;
}

/**
 * Content-level dedupe scoped to a single source. Catches re-posts that
 * keep the same text/media but get a fresh external_id (account re-shares,
 * edited tweets that flip rest_id, re-uploads of the same article).
 */
export async function contentAlreadySeenForSource(
  sourceId: string,
  contentHash: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM raw_items WHERE source_id = $1 AND content_hash = $2 LIMIT 1',
    [sourceId, contentHash],
  );
  return rows.length > 0;
}

/**
 * Fuzzy match: pull recent simhashes for the same source and return the
 * closest one. Caller decides the threshold — default 3/63 ≈ 95% similar.
 */
export async function nearestSimhash(
  sourceId: string,
  fingerprint: bigint,
  opts: { windowDays?: number; limit?: number } = {},
): Promise<{ id: string; distance: number } | null> {
  const windowDays = opts.windowDays ?? 30;
  const limit = opts.limit ?? 2000;

  const rows = await query<{ id: string; simhash: string }>(
    `SELECT id, simhash::text AS simhash
     FROM raw_items
     WHERE source_id = $1
       AND simhash IS NOT NULL
       AND fetched_at > NOW() - ($2 || ' days')::interval
     ORDER BY fetched_at DESC
     LIMIT $3`,
    [sourceId, windowDays, limit],
  );

  let best: { id: string; distance: number } | null = null;
  for (const r of rows) {
    const d = hamming(fingerprint, BigInt(r.simhash));
    if (best === null || d < best.distance) best = { id: r.id, distance: d };
    if (best.distance === 0) break;
  }
  return best;
}
