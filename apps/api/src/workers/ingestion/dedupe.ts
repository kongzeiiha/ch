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

/** Single-item lookup kept for backward-compat / ad-hoc use. */
export async function urlAlreadySeen(sourceId: string, key: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM raw_items WHERE source_id = $1 AND dedupe_key = $2 LIMIT 1',
    [sourceId, key],
  );
  return rows.length > 0;
}

/**
 * Batch URL dedupe — one query for all candidates.
 * Returns a Set of dedupe_keys that already exist for the source.
 */
export async function seenDedupeKeys(sourceId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await query<{ dedupe_key: string }>(
    'SELECT dedupe_key FROM raw_items WHERE source_id = $1 AND dedupe_key = ANY($2::text[])',
    [sourceId, keys],
  );
  return new Set(rows.map((r) => r.dedupe_key));
}

/**
 * Batch content-hash dedupe — one query for all candidates.
 * Returns a Set of content_hashes already seen for the source.
 */
export async function seenContentHashes(sourceId: string, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await query<{ content_hash: string }>(
    'SELECT content_hash FROM raw_items WHERE source_id = $1 AND content_hash = ANY($2::text[])',
    [sourceId, hashes],
  );
  return new Set(rows.map((r) => r.content_hash));
}

/**
 * Pre-load all recent simhashes for a source in one query.
 * Returns an array suitable for in-process nearest-neighbour search.
 * Call once per source batch, then pass to findNearestSimhash() per candidate.
 */
export async function loadSimhashes(
  sourceId: string,
  opts: { windowDays?: number; limit?: number } = {},
): Promise<Array<{ id: string; simhash: bigint }>> {
  const windowDays = opts.windowDays ?? 30;
  const limit = opts.limit ?? 2000;
  const rows = await query<{ id: string; simhash: string }>(
    `SELECT id, CAST(simhash AS CHAR) AS simhash
     FROM raw_items
     WHERE source_id = $1
       AND simhash IS NOT NULL
       AND fetched_at > NOW() - INTERVAL $2 DAY
     ORDER BY fetched_at DESC
     LIMIT $3`,
    [sourceId, windowDays, limit],
  );
  return rows.map((r) => ({ id: r.id, simhash: BigInt(r.simhash) }));
}

/** In-process nearest-neighbour search over a pre-loaded simhash set. */
export function findNearestSimhash(
  fingerprint: bigint,
  pool: Array<{ id: string; simhash: bigint }>,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const r of pool) {
    const d = hamming(fingerprint, r.simhash);
    if (best === null || d < best.distance) best = { id: r.id, distance: d };
    if (best.distance === 0) break;
  }
  return best;
}

/**
 * Content-level dedupe scoped to a single source. Kept for backward-compat.
 * Use seenContentHashes() for batch processing.
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
 * Single-item fuzzy match. Kept for backward-compat.
 * Use loadSimhashes() + findNearestSimhash() for batch processing.
 */
export async function nearestSimhash(
  sourceId: string,
  fingerprint: bigint,
  opts: { windowDays?: number; limit?: number } = {},
): Promise<{ id: string; distance: number } | null> {
  const pool = await loadSimhashes(sourceId, opts);
  return findNearestSimhash(fingerprint, pool);
}
