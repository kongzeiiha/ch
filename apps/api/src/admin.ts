import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import type { IngestionJob } from './workers/ingestion/index.js';
import { ingestSource } from './workers/ingestion/index.js';

/**
 * Validate source config against its platform. Returns null when valid, or
 * a human-readable error message describing what's missing. Run on both POST
 * (create) and PATCH (update) so a malformed source can never enter the queue
 * and waste retry budget like the bf306848 bug did.
 */
function validateSourceConfig(platform: string, config: Record<string, unknown> | null | undefined): string | null {
  const cfg = config ?? {};
  const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const isNonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;
  const isHttpUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

  switch (platform) {
    case 'rss':
      if (!isNonEmptyString(cfg.feed_url)) return 'rss 平台必须填 config.feed_url';
      if (!isHttpUrl(cfg.feed_url)) return 'config.feed_url 必须是 http(s) 开头的 URL';
      return null;

    case 'html': {
      const mode = cfg.mode || 'article';
      if (mode === 'crawl') {
        if (!isNonEmptyString(cfg.entry)) return 'html crawl 模式必须填 config.entry';
        if (!isHttpUrl(cfg.entry)) return 'config.entry 必须是 http(s) URL';
      } else {
        if (!isNonEmptyArray(cfg.urls)) return `html ${mode} 模式必须填 config.urls (URL 列表)`;
        const bad = (cfg.urls as unknown[]).find((u) => !isHttpUrl(u));
        if (bad !== undefined) return `config.urls 中存在非 http(s) URL: ${String(bad).slice(0, 60)}`;
      }
      return null;
    }

    case '2ksg':
      if (!isNonEmptyArray(cfg.ids)) return '2ksg 平台必须填 config.ids (图册 ID 列表)';
      if (!isNonEmptyString(cfg.token)) return '2ksg 平台必须填 config.token';
      return null;

    case 'knit':
      if (!isNonEmptyArray(cfg.urls)) return 'knit 平台必须填 config.urls (article URL 列表)';
      if (!isNonEmptyString(cfg.cookie)) return 'knit 平台必须填 config.cookie (含 cf_clearance)';
      return null;

    case 'reddit':
      if (!isNonEmptyArray(cfg.subreddits)) return 'reddit 平台必须填 config.subreddits (subreddit 列表,如 ["EarthPorn","photographs"])';
      return null;

    case 'bluesky': {
      const mode = cfg.mode || 'author';
      if (mode === 'author' && !isNonEmptyString(cfg.actor)) {
        return 'bluesky author 模式必须填 config.actor (handle,例如 "pfrazee.com")';
      }
      if (mode === 'search' && !isNonEmptyString(cfg.query)) {
        return 'bluesky search 模式必须填 config.query (搜索词或 #hashtag)';
      }
      if (mode !== 'author' && mode !== 'search') {
        return 'bluesky config.mode 必须是 "author" 或 "search"';
      }
      return null;
    }

    case 'sitemap-images':
      if (!isNonEmptyString(cfg.sitemapUrl)) return 'sitemap-images 平台必须填 config.sitemapUrl';
      if (!isHttpUrl(cfg.sitemapUrl)) return 'config.sitemapUrl 必须是 http(s) URL';
      return null;

    case 'x': {
      if (!isNonEmptyString(cfg.cookie)) return 'x 平台必须填 config.cookie (含 auth_token + ct0)';
      if (!/(?:^|;\s*)ct0=/.test(cfg.cookie as string)) return 'cookie 中找不到 ct0 字段(CSRF token 必需)';
      const mode = cfg.mode || 'user';
      if (mode === 'user' && !isNonEmptyString(cfg.screenName)) {
        return 'x user 模式必须填 config.screenName (handle,如 "natgeo")';
      }
      // Strip leading @ from screenName so DB stays consistent regardless of
      // whether user wrote "@natgeo" or "natgeo". Adapter also strips at
      // runtime but normalizing here keeps reads predictable.
      if (mode === 'user' && typeof cfg.screenName === 'string' && cfg.screenName.startsWith('@')) {
        (cfg as Record<string, unknown>).screenName = cfg.screenName.slice(1);
      }
      if (mode === 'search' && !isNonEmptyString(cfg.query)) {
        return 'x search 模式必须填 config.query';
      }
      if (mode !== 'user' && mode !== 'search') {
        return 'x config.mode 必须是 "user" 或 "search"';
      }
      return null;
    }

    default:
      return `未知平台 "${platform}",支持: rss / html / 2ksg / knit / reddit / bluesky / sitemap-images / x`;
  }
}

export async function registerAdmin(app: FastifyInstance): Promise<void> {
  // List sources
  app.get('/admin/sources', async () => {
    const rows = await query(
      `SELECT id, platform, external_id, name, url, status, score, last_fetch_at, config
       FROM sources ORDER BY created_at DESC`,
    );
    return { sources: rows };
  });

  // Create source
  app.post<{ Body: { platform: string; external_id: string; name: string; url: string; config: Record<string, unknown> } }>(
    '/admin/sources',
    async (req, reply) => {
      const { platform, external_id, name, url, config } = req.body;
      const err = validateSourceConfig(platform, config);
      if (err) return reply.code(400).send({ error: err });
      const rows = await query(
        `INSERT INTO sources (platform, external_id, name, url, config, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (platform, external_id) DO UPDATE SET
           name = EXCLUDED.name, url = EXCLUDED.url, config = EXCLUDED.config, status = 'active'
         RETURNING *`,
        [platform, external_id, name, url, config ?? {}],
      );
      return { source: rows[0] };
    },
  );

  // Update source
  app.patch<{ Params: { id: string }; Body: { name?: string; url?: string; status?: string; config?: Record<string, unknown> } }>(
    '/admin/sources/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { name, url, status, config } = req.body;
      // If config is being changed, validate it against the source's current
      // platform (config alone could turn a good source bad).
      if (config !== undefined) {
        const cur = await query<{ platform: string }>(
          `SELECT platform FROM sources WHERE id = $1`,
          [id],
        );
        if (!cur.length) return reply.code(404).send({ error: 'source not found' });
        const err = validateSourceConfig(cur[0].platform, config);
        if (err) return reply.code(400).send({ error: err });
      }
      const rows = await query(
        `UPDATE sources SET
           name   = COALESCE($2, name),
           url    = COALESCE($3, url),
           status = COALESCE($4, status),
           config = COALESCE($5, config)
         WHERE id = $1 RETURNING *`,
        [id, name ?? null, url ?? null, status ?? null, config ?? null],
      );
      if (!rows.length) return reply.code(404).send({ error: 'source not found' });
      return { source: rows[0] };
    },
  );

  // Delete source. Defaults to safe mode: if any items reference it, return 409
  // with the count so the client can ask for confirmation. Pass ?cascade=1 to
  // delete the items (plus their analytics/distribution cascade) and the source.
  app.delete<{ Params: { id: string }; Querystring: { cascade?: string } }>(
    '/admin/sources/:id',
    async (req, reply) => {
      const { id } = req.params;
      if (req.query.cascade === '1') {
        // Deactivate first to stop any concurrent ingestion worker from
        // inserting new items for this source between the two DELETEs.
        await query(`UPDATE sources SET status = 'inactive' WHERE id = $1`, [id]);
        await query(`DELETE FROM items WHERE source_id = $1`, [id]);
        await query(`DELETE FROM sources WHERE id = $1`, [id]);
        return { ok: true, cascade: true };
      }
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM items WHERE source_id = $1`,
        [id],
      );
      const itemCount = rows[0]?.count ?? 0;
      if (itemCount > 0) {
        return reply.code(409).send({
          itemCount,
          message: `此源关联了 ${itemCount} 篇文章，附 ?cascade=1 可级联删除。`,
        });
      }
      await query(`DELETE FROM sources WHERE id = $1`, [id]);
      return { ok: true };
    },
  );

  // Fan out ingestion to all active sources (async via queue)
  app.post('/admin/ingest/fanout', async () => {
    const q = getQueue<IngestionJob>(QUEUE_NAMES.ingestion);
    const job = await q.add('fanout', { kind: 'fanout' });
    return { jobId: job.id };
  });

  // Ingest one source synchronously (blocks until done — useful for smoke tests)
  app.post<{ Params: { id: string }; Querystring: { async?: string } }>(
    '/admin/ingest/:id',
    async (req) => {
      const { id } = req.params;
      if (req.query.async === '1') {
        const q = getQueue<IngestionJob>(QUEUE_NAMES.ingestion);
        const job = await q.add('ingest', { kind: 'ingest', sourceId: id });
        return { jobId: job.id, mode: 'async' };
      }
      const stats = await ingestSource(id);
      return { mode: 'sync', stats };
    },
  );

  // Pipeline stats — cheap dashboard for the Day 2 smoke test
  app.get('/admin/stats', async () => {
    const [sources] = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM sources`,
    );
    const [raw] = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM raw_items`,
    );
    const byStatus = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::int AS count FROM items GROUP BY status ORDER BY status`,
    );
    const runs = await query(
      `SELECT id, agent, status, latency_ms, cost_usd, started_at, finished_at,
              CASE WHEN length(error) > 200 THEN left(error, 200) || '…' ELSE error END AS error
       FROM agent_runs
       ORDER BY started_at DESC
       LIMIT 20`,
    );
    return {
      sources: Number(sources.count),
      raw_items: Number(raw.count),
      items_by_status: byStatus,
      recent_runs: runs,
    };
  });

  // Clear failed/completed/delayed jobs from a BullMQ queue. Uses
  // queue.clean() so BullMQ's internal indexes stay consistent (raw DEL would
  // leave dangling job hashes).
  app.post<{ Params: { name: string }; Querystring: { status?: string; grace?: string } }>(
    '/admin/queues/:name/clean',
    async (req, reply) => {
      const validNames = Object.values(QUEUE_NAMES) as readonly string[];
      const name = req.params.name;
      if (!validNames.includes(name)) {
        return reply.code(404).send({ error: `unknown queue ${name}` });
      }
      const status = (req.query.status ?? 'failed') as 'failed' | 'completed' | 'delayed' | 'wait' | 'active' | 'paused';
      // Default grace = 0 means clean every job in this state regardless of age.
      const grace = Math.max(0, Number(req.query.grace ?? 0));
      const limit = 5000;
      const q = getQueue(name as (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]);
      const removed = await q.clean(grace, limit, status);
      return { queue: req.params.name, status, removed: removed.length };
    },
  );

  // Proxy a remote image through this API with the right anti-hotlink headers
  // for the requesting source. Used by 工作台/采集预览 because pic.ylimg.com
  // (2ksg) needs a Referer and xx.knit.bid needs cf_clearance — both fail when
  // the browser fetches them directly.
  app.get<{ Querystring: { url?: string; source_id?: string } }>(
    '/admin/proxy-image',
    async (req, reply) => {
      const remoteUrl = req.query.url;
      const sourceId = req.query.source_id;
      if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) {
        return reply.code(400).send({ error: 'bad url' });
      }
      // Best-effort source lookup for header customization. Falls back to a
      // browser UA-only request when no source is known.
      let platform = '';
      let cfg: Record<string, unknown> = {};
      if (sourceId) {
        const rows = await query<{ platform: string; config: Record<string, unknown> }>(
          `SELECT platform, config FROM sources WHERE id = $1`,
          [sourceId],
        );
        if (rows[0]) { platform = rows[0].platform; cfg = rows[0].config ?? {}; }
      }
      const ua = (cfg.userAgent as string) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
      const headers: Record<string, string> = {
        'User-Agent': ua,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      };
      if (platform === '2ksg') {
        headers['Referer'] = (cfg.referer as string) || 'https://uib.2ksg.com/';
      } else if (platform === 'knit') {
        headers['Referer'] = 'https://xx.knit.bid/';
        if (cfg.cookie) headers['Cookie'] = cfg.cookie as string;
      } else if (platform === 'x') {
        // X media (pbs.twimg.com / video.twimg.com) accepts no-Referer, but
        // logged-in cookies help avoid intermittent NSFW gating on photos.
        headers['Referer'] = 'https://x.com/';
        if (cfg.cookie) headers['Cookie'] = cfg.cookie as string;
      }

      try {
        // Forward client Range header for video seek support.
        const rangeHeader = req.headers['range'];
        if (typeof rangeHeader === 'string') headers['Range'] = rangeHeader;

        const upstream = await fetch(remoteUrl, { headers, redirect: 'follow' });
        if (!upstream.ok && upstream.status !== 206) {
          return reply.code(upstream.status).send({ error: 'upstream', status: upstream.status });
        }
        const ct = upstream.headers.get('content-type') || 'image/jpeg';
        const cl = upstream.headers.get('content-length');
        const cr = upstream.headers.get('content-range');
        const ar = upstream.headers.get('accept-ranges');

        // Detect "200 OK but empty body" hotlink shenanigans up front (only
        // safe to do when content-length is present — otherwise we'd consume
        // the body and lose streaming for big videos).
        if (cl !== null && Number(cl) === 0) {
          return reply.code(502).send({ error: 'empty body — likely hotlink-blocked' });
        }

        reply
          .code(upstream.status)
          .header('Content-Type', ct)
          .header('Cache-Control', 'public, max-age=86400');
        if (cl) reply.header('Content-Length', cl);
        if (cr) reply.header('Content-Range', cr);
        if (ar) reply.header('Accept-Ranges', ar);

        // Stream the body through (no buffering) so big videos don't blow up
        // undici's body-size limit. fastify accepts a Node Readable directly.
        if (!upstream.body) {
          return reply.send(Buffer.alloc(0));
        }
        // Convert WHATWG ReadableStream → Node Readable for fastify.
        // Node 18+ has Readable.fromWeb for exactly this.
        const { Readable } = await import('node:stream');
        const nodeStream = Readable.fromWeb(upstream.body as any);
        return reply.send(nodeStream);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        reply.code(502).send({ error: 'fetch fail', detail: msg });
      }
    },
  );

  // Sources whose latest ingestion run flagged an auth failure (expired
  // cookie / token / cf_clearance). Looks at the most recent ingestion
  // agent_run per source within the last 6 hours.
  app.get('/admin/sources/auth-status', async () => {
    const rows = await query<{
      id: string; name: string; platform: string;
      auth_status: number | null; auth_reason: string | null;
      candidates: number | null; finished_at: string;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (input_hash)
           input_hash AS source_id,
           output,
           finished_at
         FROM agent_runs
         WHERE agent = 'ingestion'
           AND status = 'success'
           AND input_hash IS NOT NULL
           AND finished_at > NOW() - INTERVAL '6 hours'
         ORDER BY input_hash, started_at DESC
       )
       SELECT
         s.id, s.name, s.platform,
         (l.output->>'authStatus')::int  AS auth_status,
          l.output->>'authReason'        AS auth_reason,
         (l.output->>'candidates')::int  AS candidates,
         l.finished_at
       FROM sources s
       JOIN latest l ON l.source_id = s.id::text
       WHERE s.status = 'active'
         AND (l.output->>'authFail')::boolean = true
       ORDER BY l.finished_at DESC`,
    );
    return { suspect: rows };
  });

  // Raw items with their crawled media — used by 工作台 / 采集预览 tab
  app.get<{ Querystring: { source_id?: string; limit?: string; offset?: string; with_media?: string } }>(
    '/admin/raw-items',
    async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 30), 1), 500);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);
      const sourceId = req.query.source_id?.trim() || null;
      const onlyWithMedia = req.query.with_media === '1';

      const where: string[] = [];
      const params: unknown[] = [];
      if (sourceId) { params.push(sourceId); where.push(`r.source_id = $${params.length}`); }
      if (onlyWithMedia) where.push(`array_length(r.media_urls, 1) > 0`);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      params.push(limit); const limitIdx = params.length;
      params.push(offset); const offsetIdx = params.length;

      const rows = await query(
        `SELECT r.id, r.url, r.fetched_at, r.media_urls, r.dedupe_key,
                s.id AS source_id, s.name AS source_name, s.platform,
                COALESCE(r.raw_payload->>'title', '') AS title,
                COALESCE(r.raw_payload->'extra'->'videoUrls', '[]'::jsonb) AS video_urls
         FROM raw_items r
         JOIN sources s ON s.id = r.source_id
         ${whereSql}
         ORDER BY r.fetched_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      const countParams = sourceId ? [sourceId] : [];
      const [countRow] = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM raw_items r
         ${sourceId ? 'WHERE r.source_id = $1' : ''}
         ${onlyWithMedia ? (sourceId ? 'AND' : 'WHERE') + ' array_length(r.media_urls, 1) > 0' : ''}`,
        countParams,
      );

      return { items: rows, total: countRow?.count ?? 0, limit, offset };
    },
  );

  // Peek at the latest ingested items
  app.get('/admin/items', async (req) => {
    const limit = Math.min(Number((req.query as any)?.limit ?? 20), 100);
    const rows = await query(
      `SELECT i.id, i.status, i.title, i.slug, i.category,
              s.name AS source, r.url, i.created_at
       FROM items i
       JOIN sources s ON s.id = i.source_id
       JOIN raw_items r ON r.id = i.raw_item_id
       ORDER BY i.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return { items: rows };
  });
}
