import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { query, execute } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import type { IngestionJob } from './workers/ingestion/index.js';
import { ingestSource } from './workers/ingestion/index.js';
import { logOperation } from './op-log.js';
import {
  sourceCreateBody,
  sourcePatchBody,
  credentialCreateBody,
  credentialPatchBody,
  credentialSecretBody,
  batchImportBody,
} from './admin-validate.js';

/**
 * Validate source config against its platform. Returns null when valid, or
 * a human-readable error message describing what's missing. Run on both POST
 * (create) and PATCH (update) so a malformed source can never enter the queue
 * and waste retry budget like the bf306848 bug did.
 */
export function validateSourceConfig(platform: string, config: Record<string, unknown> | null | undefined): string | null {
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
      // Accept either single `subreddit` (new, one-source-per-sub batch model)
      // or legacy `subreddits[]` (multiple subs in one source). At least one
      // form must be present and non-empty.
      if (!isNonEmptyString(cfg.subreddit) && !isNonEmptyArray(cfg.subreddits)) {
        return 'reddit 平台必须填 config.subreddit (单 subreddit 名) 或 config.subreddits (subreddit 列表)';
      }
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
  // List sources. credential_id + credential_name are joined in so the UI can
  // surface "🔑 ZK01" — without this, sources backed by the credential pool
  // appear to have no auth at all (their config carries no cookie by design).
  app.get('/admin/sources', async () => {
    const rows = await query(
      `SELECT s.id, s.platform, s.external_id, s.name, s.url, s.status,
              s.score, s.risk_level, s.stability,
              s.last_fetch_at, s.config, s.credential_id,
              c.name AS credential_name, c.status AS credential_status
       FROM sources s
       LEFT JOIN credentials c ON c.id = s.credential_id
       ORDER BY s.created_at DESC`,
    );
    return { sources: rows };
  });

  // Create source
  app.post<{ Body: { platform: string; external_id: string; name: string; url: string; config: Record<string, unknown> } }>(
    '/admin/sources',
    { schema: { body: sourceCreateBody } },
    async (req, reply) => {
      const { platform, external_id, name, url, config } = req.body;
      const err = validateSourceConfig(platform, config);
      if (err) return reply.code(400).send({ error: err });
      // MySQL upsert: INSERT ... ON DUPLICATE KEY UPDATE. affectedRows: 1=insert, 2=update.
      const newId = randomUUID();
      const r = await execute(
        `INSERT INTO sources (id, platform, external_id, name, url, config, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), url = VALUES(url), config = VALUES(config), status = 'active'`,
        [newId, platform, external_id, name, url, JSON.stringify(config ?? {})],
      );
      const wasInsert = r.affectedRows === 1;
      const rows = await query<any>(
        `SELECT * FROM sources WHERE platform = $1 AND external_id = $2`,
        [platform, external_id],
      );
      const source = rows[0];
      await logOperation(req, {
        operation: wasInsert ? 'source.create' : 'source.upsert',
        targetType: 'source',
        targetId: source.id,
        payload: { platform, external_id, name, url, config: config ?? {} },
      });
      return { source };
    },
  );

  // ── Credentials CRUD ──────────────────────────────────────────────────
  // Shared credential pool. Lets one cookie/UA pair back many sources, so
  // rotating a session token doesn't require updating 50 source rows.

  app.get('/admin/credentials', async () => {
    // We never return the cookie body in list views — UI shows length only.
    // Same applies to credential_secrets: the password ciphertext is hidden,
    // we only surface "has_secret" + the username and last refresh outcome.
    const rows = await query(
      `SELECT c.id, c.platform, c.name, c.status,
              CASE WHEN c.cookie IS NULL THEN 0 ELSE length(c.cookie) END AS cookie_len,
              c.user_agent,
              c.last_used_at, c.last_auth_check_at, c.last_auth_ok,
              c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM sources WHERE credential_id = c.id) AS source_count,
              (cs.credential_id IS NOT NULL)            AS has_secret,
              cs.username                                AS secret_username,
              cs.last_refresh_at                         AS secret_last_refresh_at,
              cs.last_refresh_ok                         AS secret_last_refresh_ok,
              cs.last_refresh_error                      AS secret_last_refresh_error,
              cs.consecutive_failures                    AS secret_consecutive_failures
       FROM credentials c
       LEFT JOIN credential_secrets cs ON cs.credential_id = c.id
       ORDER BY c.platform, c.name`,
    );
    return { credentials: rows };
  });

  app.post<{ Body: { platform: string; name: string; cookie?: string; user_agent?: string } }>(
    '/admin/credentials',
    { schema: { body: credentialCreateBody } },
    async (req, reply) => {
      const { platform, name, cookie, user_agent } = req.body;
      if (platform !== 'x' && platform !== 'knit' && platform !== 'bluesky') {
        return reply.code(400).send({ error: `凭证池目前支持 platform: x / knit / bluesky` });
      }
      // X needs ct0 in the cookie for CSRF. Catch the most common paste mistake
      // here so the user doesn't discover it only when ingestion fails.
      if (platform === 'x' && cookie && !/(?:^|;\s*)ct0=/.test(cookie)) {
        return reply.code(400).send({ error: 'X 凭证的 cookie 必须含 ct0=…（CSRF token）' });
      }
      const newId = randomUUID();
      await execute(
        `INSERT INTO credentials (id, platform, name, cookie, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         ON DUPLICATE KEY UPDATE
           cookie = VALUES(cookie),
           user_agent = VALUES(user_agent),
           status = 'active',
           last_auth_check_at = NULL,
           last_auth_ok = NULL`,
        [newId, platform, name, cookie ?? null, user_agent ?? null],
      );
      const rows = await query(
        `SELECT id, platform, name, status, length(cookie) AS cookie_len, user_agent
         FROM credentials WHERE platform = $1 AND name = $2`,
        [platform, name],
      );
      return { credential: rows[0] };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; cookie?: string; user_agent?: string; status?: string };
  }>(
    '/admin/credentials/:id',
    { schema: { body: credentialPatchBody } },
    async (req, reply) => {
      const { id } = req.params;
      const { name, cookie, user_agent, status } = req.body ?? ({} as any);
      const r = await execute(
        `UPDATE credentials SET
           name       = COALESCE($2, name),
           cookie     = COALESCE($3, cookie),
           user_agent = COALESCE($4, user_agent),
           status     = COALESCE($5, status),
           last_auth_check_at = CASE WHEN $3 IS NOT NULL THEN NULL ELSE last_auth_check_at END,
           last_auth_ok       = CASE WHEN $3 IS NOT NULL THEN NULL ELSE last_auth_ok END
         WHERE id = $1`,
        [id, name ?? null, cookie ?? null, user_agent ?? null, status ?? null],
      );
      if (r.affectedRows === 0) return reply.code(404).send({ error: 'credential not found' });
      const rows = await query(
        `SELECT id, platform, name, status, length(cookie) AS cookie_len, user_agent
         FROM credentials WHERE id = $1`,
        [id],
      );

      // Re-activating a credential is the user overriding our auto-revoke
      // decision (or pasting a fresh cookie after the old one expired). Reset
      // the secret's failure trail so the refresh scheduler will pick it up
      // again next cycle. Without this, status flips back but failures stay
      // at 3 and the scan keeps skipping it.
      if (status === 'active') {
        try {
          await query(
            `UPDATE credential_secrets SET
               consecutive_failures = 0,
               last_refresh_error = NULL
             WHERE credential_id = $1`,
            [id],
          );
        } catch (e: any) {
          // ER_NO_SUCH_TABLE (1146) — tolerate if migration 0011 hasn't been
          // applied yet. Anything else (FK, connection, lock) is a real error
          // and must surface; silently swallowing them is what the previous
          // bare .catch() did and it masked operational failures.
          if (e?.code !== 'ER_NO_SUCH_TABLE' && e?.errno !== 1146) throw e;
        }
      }
      return { credential: rows[0] };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/credentials/:id',
    async (req, reply) => {
      const { id } = req.params;
      // FK is ON DELETE SET NULL on sources, ON DELETE CASCADE on secrets.
      const r = await execute(`DELETE FROM credentials WHERE id = $1`, [id]);
      if (r.affectedRows === 0) return reply.code(404).send({ error: 'credential not found' });
      return { ok: true };
    },
  );

  // ── Credential secrets (encrypted username/password for auto-refresh) ──
  // Stored in credential_secrets, AES-256-GCM encrypted with CREDENTIAL_SECRET_KEY.
  // Set this once when adding the credential; the refresh worker uses it to
  // re-login via stealth Playwright and rotate the cookie when it expires.

  app.post<{ Params: { id: string }; Body: { username: string; password: string } }>(
    '/admin/credentials/:id/secret',
    { schema: { body: credentialSecretBody } },
    async (req, reply) => {
      const { id } = req.params;
      const { username, password } = req.body;
      // Verify the credential exists first; FK would catch this but the error
      // is clearer this way.
      const cred = await query<{ platform: string }>(
        `SELECT platform FROM credentials WHERE id = $1`, [id],
      );
      if (!cred.length) return reply.code(404).send({ error: 'credential not found' });

      const { encrypt } = await import('./crypto.js');
      let blob: string;
      try {
        blob = encrypt(password);
      } catch (e: any) {
        return reply.code(500).send({ error: `加密失败：${e?.message}（检查 CREDENTIAL_SECRET_KEY 是否设置）` });
      }
      // Resetting failure count on every set is intentional — the user just
      // gave us new credentials, treat it as a fresh start.
      await query(
        `INSERT INTO credential_secrets (credential_id, username, password_blob, consecutive_failures)
         VALUES ($1, $2, $3, 0)
         ON DUPLICATE KEY UPDATE
           username = VALUES(username),
           password_blob = VALUES(password_blob),
           consecutive_failures = 0,
           last_refresh_at = NULL,
           last_refresh_ok = NULL,
           last_refresh_error = NULL`,
        [id, username, blob],
      );
      return { ok: true, has_secret: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/credentials/:id/secret',
    async (req, reply) => {
      const { id } = req.params;
      const r = await execute(
        `DELETE FROM credential_secrets WHERE credential_id = $1`,
        [id],
      );
      if (r.affectedRows === 0) return reply.code(404).send({ error: 'no secret stored for this credential' });
      return { ok: true };
    },
  );

  // Trigger an immediate refresh attempt. Two modes:
  //   - default (async): enqueue a refresh-one job, return the jobId
  //   - ?sync=1: run the stealth login synchronously and return the result.
  //     Useful for the workbench "立即刷新" button — user wants to see
  //     success/failure right away.
  app.post<{ Params: { id: string }; Querystring: { sync?: string } }>(
    '/admin/credentials/:id/refresh',
    async (req, reply) => {
      const { id } = req.params;
      const has = await query<{ id: string }>(
        `SELECT cs.credential_id AS id FROM credential_secrets cs
         JOIN credentials c ON c.id = cs.credential_id
         WHERE cs.credential_id = $1 AND c.platform = 'x'`,
        [id],
      );
      if (!has.length) {
        return reply.code(404).send({
          error: 'no X secret attached to this credential. POST /admin/credentials/:id/secret first.',
        });
      }

      if (req.query.sync === '1') {
        // Inline import so the playwright dep doesn't load on every cold start.
        const { refreshOne } = await import('./workers/credential-refresh/index.js');
        const result = await refreshOne(id);
        return { mode: 'sync', ...result };
      }
      const q = getQueue(QUEUE_NAMES.credentialRefresh);
      const job = await q.add(
        'refresh-one',
        { kind: 'refresh-one', credentialId: id },
        { jobId: `refresh__${id}__${Date.now()}` },
      );
      return { mode: 'async', jobId: job.id };
    },
  );

  // ── Batch import: create/update many handle-based sources at once.
  // For X / Bluesky the natural unit is one source per handle (each handle has
  // its own state — last_fetch_at, score, auth status). The user pastes a list
  // of handles, the system materializes them as N source rows sharing the
  // session cookie / limit knobs from `sharedConfig`. Reddit stays as-is
  // because its existing model already accepts subreddits[] in one source.
  app.post<{
    Body: {
      platform: 'x' | 'bluesky' | 'reddit';
      handles: string[];
      sharedConfig?: Record<string, unknown>;
      /** Optional shared credential id. When set, every created source points
       *  to this credential and we don't need an inline cookie in sharedConfig. */
      credentialId?: string;
      triggerFetch?: boolean;
    };
  }>(
    '/admin/sources/batch-import',
    { schema: { body: batchImportBody } },
    async (req, reply) => {
      const { platform, handles, sharedConfig = {}, credentialId, triggerFetch = false } = req.body;

      // Normalize, dedupe, drop blanks. X/Bluesky handles are case-insensitive
      // and may be pasted with leading @ or surrounding whitespace. Reddit
      // accepts an optional /r/ prefix (e.g. "r/EarthPorn", "/r/photographs").
      const seen = new Set<string>();
      const normalized: string[] = [];
      for (const raw of handles) {
        if (typeof raw !== 'string') continue;
        let h = raw.trim();
        if (platform === 'reddit') {
          h = h.replace(/^\/?r\//i, '').replace(/^\/+|\/+$/g, '');
        } else {
          h = h.replace(/^@/, '');
        }
        h = h.toLowerCase();
        if (!h || seen.has(h)) continue;
        seen.add(h);
        normalized.push(h);
      }
      if (normalized.length === 0) {
        return reply.code(400).send({ error: 'handles 全部为空/无效' });
      }
      if (normalized.length > 500) {
        return reply.code(400).send({ error: '单次最多导入 500 个 handle' });
      }

      // If a credentialId is provided, validate it once up front and remember
      // its cookie so per-handle config validation passes without us having to
      // duplicate the cookie into every source row.
      let credentialCookie: string | null = null;
      if (credentialId) {
        const credRows = await query<{ platform: string; status: string; cookie: string | null }>(
          `SELECT platform, status, cookie FROM credentials WHERE id = $1`,
          [credentialId],
        );
        if (!credRows.length) return reply.code(400).send({ error: 'credentialId 不存在' });
        if (credRows[0].platform !== platform) {
          return reply.code(400).send({ error: `credentialId 的 platform=${credRows[0].platform}，与导入 platform=${platform} 不一致` });
        }
        if (credRows[0].status !== 'active') {
          return reply.code(400).send({ error: `credentialId 状态不是 active（当前 ${credRows[0].status}）` });
        }
        credentialCookie = credRows[0].cookie;
      }

      const created: Array<{ handle: string; sourceId: string }> = [];
      const updated: Array<{ handle: string; sourceId: string }> = [];
      const failed: Array<{ handle: string; reason: string }> = [];

      for (const handle of normalized) {
        try {
          // Build per-source config by merging shared knobs with the per-handle
          // identifier. We put the per-handle key last so callers can't
          // accidentally override it via sharedConfig.
          const config: Record<string, unknown> =
            platform === 'x'
              ? { ...sharedConfig, mode: 'user', screenName: handle }
              : platform === 'bluesky'
                ? { ...sharedConfig, mode: 'author', actor: handle }
                : { ...sharedConfig, subreddit: handle };

          // Validate against either the inline cookie OR the credential's
          // cookie. The credential's cookie is NOT persisted into config — we
          // only borrow it for the validator pass.
          const cfgForValidation = credentialCookie
            ? { ...config, cookie: credentialCookie }
            : config;
          const validationErr = validateSourceConfig(platform, cfgForValidation);
          if (validationErr) {
            failed.push({ handle, reason: validationErr });
            continue;
          }

          const externalId = handle;
          const name =
            platform === 'x' ? `@${handle}` :
            platform === 'reddit' ? `r/${handle}` :
            handle;
          const url =
            platform === 'x' ? `https://x.com/${handle}` :
            platform === 'reddit' ? `https://www.reddit.com/r/${handle}` :
            `https://bsky.app/profile/${handle}`;

          // MySQL upsert via INSERT ... ON DUPLICATE KEY UPDATE.
          // affectedRows: 1 = insert (new row), 2 = update (existing row matched).
          const newId = randomUUID();
          const upsertResult = await execute(
            `INSERT INTO sources (id, platform, external_id, name, url, config, status, credential_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               url = VALUES(url),
               config = VALUES(config),
               status = 'active',
               credential_id = VALUES(credential_id)`,
            [newId, platform, externalId, name, url, JSON.stringify(config), credentialId ?? null],
          );
          const wasInsert = upsertResult.affectedRows === 1;
          const idRows = await query<{ id: string }>(
            `SELECT id FROM sources WHERE platform = $1 AND external_id = $2`,
            [platform, externalId],
          );
          const row = { id: idRows[0]!.id, was_insert: wasInsert };
          (row.was_insert ? created : updated).push({ handle, sourceId: row.id });

          if (triggerFetch) {
            const q = getQueue<IngestionJob>(QUEUE_NAMES.ingestion);
            await q.add(
              'ingest',
              { kind: 'ingest', sourceId: row.id },
              { jobId: `ingest__batch__${row.id}__${Date.now()}` },
            );
          }
        } catch (e: any) {
          failed.push({ handle, reason: e?.message ?? String(e) });
        }
      }

      await logOperation(req, {
        operation: 'source.batch-import',
        targetType: 'system',
        targetId: null,
        payload: {
          platform,
          createdCount: created.length,
          updatedCount: updated.length,
          failedCount: failed.length,
          createdIds: created.map((c) => c.sourceId),
          updatedIds: updated.map((u) => u.sourceId),
          credentialId: credentialId ?? null,
          triggerFetch,
        },
      });
      return { platform, created, updated, failed, triggerFetch };
    },
  );

  // Update source
  app.patch<{ Params: { id: string }; Body: { name?: string; url?: string; status?: string; config?: Record<string, unknown> } }>(
    '/admin/sources/:id',
    { schema: { body: sourcePatchBody } },
    async (req, reply) => {
      const { id } = req.params;
      const { name, url, status, config } = req.body ?? ({} as any);
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
      const r = await execute(
        `UPDATE sources SET
           name   = COALESCE($2, name),
           url    = COALESCE($3, url),
           status = COALESCE($4, status),
           config = COALESCE($5, config)
         WHERE id = $1`,
        [id, name ?? null, url ?? null, status ?? null, config !== undefined ? JSON.stringify(config) : null],
      );
      if (r.affectedRows === 0) return reply.code(404).send({ error: 'source not found' });
      const rows = await query(`SELECT * FROM sources WHERE id = $1`, [id]);
      await logOperation(req, {
        operation: 'source.update',
        targetType: 'source',
        targetId: id,
        payload: {
          changed: { name, url, status, config },
        },
      });
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
        const itemRows = await query<{ count: number }>(
          `SELECT COUNT(*) AS count FROM items WHERE source_id = $1`,
          [id],
        );
        await query(`DELETE FROM items WHERE source_id = $1`, [id]);
        await query(`DELETE FROM sources WHERE id = $1`, [id]);
        await logOperation(req, {
          operation: 'source.delete',
          targetType: 'source',
          targetId: id,
          payload: { cascade: true, deletedItemCount: itemRows[0]?.count ?? 0 },
        });
        return { ok: true, cascade: true };
      }
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM items WHERE source_id = $1`,
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
      await logOperation(req, {
        operation: 'source.delete',
        targetType: 'source',
        targetId: id,
        payload: { cascade: false },
      });
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
      `SELECT COUNT(*) AS count FROM sources`,
    );
    const [raw] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM raw_items`,
    );
    const byStatus = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM items GROUP BY status ORDER BY status`,
    );
    const runs = await query(
      `SELECT id, agent, status, latency_ms, cost_usd, started_at, finished_at,
              CASE WHEN length(error) > 200 THEN CONCAT(left(error, 200), '…') ELSE error END AS error
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

      // Allowed hostnames per platform for cookie forwarding. Cookies must
      // never be forwarded to a hostname that doesn't belong to the platform —
      // that would let an authenticated admin exfiltrate platform credentials.
      const COOKIE_ALLOWED: Record<string, RegExp> = {
        knit: /(?:^|\.)knit\.bid$/,
        x:    /(?:^|\.)(?:twimg\.com|x\.com|twitter\.com)$/,
      };
      let remoteHost = '';
      try { remoteHost = new URL(remoteUrl).hostname; } catch { /* invalid url caught earlier */ }

      if (platform === '2ksg') {
        headers['Referer'] = (cfg.referer as string) || 'https://uib.2ksg.com/';
      } else if (platform === 'knit') {
        headers['Referer'] = 'https://xx.knit.bid/';
        if (cfg.cookie && COOKIE_ALLOWED.knit.test(remoteHost)) headers['Cookie'] = cfg.cookie as string;
      } else if (platform === 'x') {
        headers['Referer'] = 'https://x.com/';
        if (cfg.cookie && COOKIE_ALLOWED.x.test(remoteHost)) headers['Cookie'] = cfg.cookie as string;
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
      `WITH ranked AS (
         SELECT input_hash AS source_id,
                output,
                finished_at,
                ROW_NUMBER() OVER (PARTITION BY input_hash ORDER BY started_at DESC) AS rn
         FROM agent_runs
         WHERE agent = 'ingestion'
           AND status = 'success'
           AND input_hash IS NOT NULL
           AND finished_at > NOW() - INTERVAL 6 HOUR
       ), latest AS (
         SELECT source_id, output, finished_at FROM ranked WHERE rn = 1
       )
       SELECT
         s.id, s.name, s.platform,
         CAST(JSON_UNQUOTE(JSON_EXTRACT(l.output, '$.authStatus')) AS SIGNED) AS auth_status,
         JSON_UNQUOTE(JSON_EXTRACT(l.output, '$.authReason'))                  AS auth_reason,
         CAST(JSON_UNQUOTE(JSON_EXTRACT(l.output, '$.candidates')) AS SIGNED) AS candidates,
         l.finished_at
       FROM sources s
       JOIN latest l ON l.source_id = s.id
       WHERE s.status = 'active'
         AND JSON_UNQUOTE(JSON_EXTRACT(l.output, '$.authFail')) = 'true'
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
      if (onlyWithMedia) where.push(`JSON_LENGTH(r.media_urls) > 0`);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      params.push(limit); const limitIdx = params.length;
      params.push(offset); const offsetIdx = params.length;

      const rows = await query(
        `SELECT r.id, r.url, r.fetched_at, r.media_urls, r.dedupe_key,
                s.id AS source_id, s.name AS source_name, s.platform,
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.raw_payload, '$.title')), '') AS title,
                COALESCE(JSON_EXTRACT(r.raw_payload, '$.extra.videoUrls'), JSON_ARRAY()) AS video_urls
         FROM raw_items r
         JOIN sources s ON s.id = r.source_id
         ${whereSql}
         ORDER BY r.fetched_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      const countParams = sourceId ? [sourceId] : [];
      const [countRow] = await query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM raw_items r
         ${sourceId ? 'WHERE r.source_id = $1' : ''}
         ${onlyWithMedia ? (sourceId ? 'AND' : 'WHERE') + ' JSON_LENGTH(r.media_urls) > 0' : ''}`,
        countParams,
      );

      return { items: rows, total: countRow?.count ?? 0, limit, offset };
    },
  );

  // Peek at the latest ingested items
  app.get('/admin/items', async (req) => {
    const q = (req.query as any) ?? {};
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const offset = Math.max(0, Number(q.offset ?? 0));
    const [rows, totalRows] = await Promise.all([
      query(
        `SELECT i.id, i.status, i.title, i.slug, i.category,
                s.name AS source, r.url, i.created_at
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN raw_items r ON r.id = i.raw_item_id
         ORDER BY i.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      query<{ cnt: string }>(`SELECT CAST(COUNT(*) AS CHAR) AS cnt FROM items`),
    ]);
    return { items: rows, total: Number(totalRows[0]?.cnt ?? 0), limit, offset };
  });
}
