import { Redis } from 'ioredis';

/**
 * Read-through cache for SSR hot reads.
 *
 * Why Redis instead of in-memory:
 *   - Next.js dev mode rebuilds the module graph on every file change, which
 *     would blow away an in-process LRU constantly during development.
 *   - In production, multi-instance deploys would each maintain their own
 *     in-process cache and stagger DB hits — Redis gives one shared layer.
 *
 * Why not Next's `unstable_cache`:
 *   - We already run a Redis instance for BullMQ; adding another cache layer
 *     would mean two TTL knobs and double bookkeeping.
 *   - `unstable_cache` is, well, unstable across Next versions and ties cache
 *     keys to the file/lib path which makes manual invalidation awkward.
 *
 * Failure mode is fail-open: any Redis error (down, timeout, connection
 * refused) falls through to compute(). The hot reads are read-only and
 * idempotent — duplicating work on a Redis blip is strictly better than 500ing
 * the page.
 */

declare global {
  // eslint-disable-next-line no-var
  var __chCacheRedisV2: Redis | undefined;
}

function client(): Redis {
  if (!global.__chCacheRedisV2) {
    // Eager connect (no lazyConnect) and keep the offline queue ON. Earlier
    // attempt with lazyConnect:true + enableOfflineQueue:false silently broke
    // the cache: every call landed before the socket finished dialing, both
    // GET and the write-back SET threw, and the Redis store stayed empty
    // forever (read-through fail-open masked the issue).
    //
    // The offline queue is bounded by maxRetriesPerRequest:1, so a truly
    // unreachable Redis fails commands quickly rather than buffering forever.
    global.__chCacheRedisV2 = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      // Connection-time and per-command timeouts so a slow/unhealthy Redis
      // doesn't drag SSR latency above what plain MySQL would cost.
      connectTimeout: 500,
      commandTimeout: 80,
    });
    global.__chCacheRedisV2.on('error', (e) => {
      // ioredis emits frequent error events while reconnecting; keep these
      // visible but don't spam SSR logs. Suppress the common ECONNREFUSED at
      // startup so dev environments without Redis don't drown stdout.
      const msg = e?.message ?? '';
      if (!msg.includes('ECONNREFUSED') && !msg.includes('Command timed out')) {
        console.warn('[cache] redis error:', msg);
      }
    });
  }
  return global.__chCacheRedisV2;
}

const KEY_PREFIX = 'ssr:';

/** Read-through GET-or-compute. ttlSeconds is the cache lifetime; 60 is a
 *  sensible default for the feed layer where freshness within a minute is
 *  fine. Set to 0 to disable caching for a single call (useful for ad-hoc
 *  bypass during incident debugging via env flag). */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  if (ttlSeconds <= 0 || process.env.CACHE_BYPASS === '1') return compute();

  const fullKey = KEY_PREFIX + key;
  const r = client();
  try {
    const hit = await r.get(fullKey);
    if (hit) {
      try { return JSON.parse(hit) as T; } catch {
        // Corrupt entry — drop it and recompute.
        await r.del(fullKey).catch(() => {});
      }
    }
  } catch (e) {
    // Redis unreachable / timed out → fall through to compute.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[cache] read failed key=${fullKey}: ${(e as any)?.message ?? e}`);
    }
  }

  const value = await compute();

  // Awaited (not fire-and-forget): in Next 15 dev/serverful, a dangling write
  // promise after the response sometimes never gets flushed before the
  // request scope is torn down and the SET silently no-ops, leaving the
  // cache empty forever. The await adds <2ms and guarantees the entry lands.
  try {
    await r.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[cache] write failed key=${fullKey}: ${(e as any)?.message ?? e}`);
    }
  }

  return value;
}

/** Manual invalidation. Used by the publishing worker after a publish/unpublish
 *  so the homepage and tag pages reflect the change without waiting out TTL. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const r = client();
  try {
    await r.del(...keys.map((k) => KEY_PREFIX + k));
  } catch {
    // Best-effort. If Redis is down the entries will expire on their own.
  }
}
