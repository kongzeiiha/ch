import { query } from '@ch/db';
import type { SourceRow } from './types.js';

interface ResolvedAuth {
  cookie?: string;
  userAgent?: string;
  /** When the auth came from the credential pool, this is the credential id —
   * adapters can record this so we know which credential to bump on auth fail. */
  credentialId?: string;
}

/**
 * Resolve the cookie + user-agent for an X / knit / similar auth-bearing
 * source. Order of precedence:
 *   1. The shared credential pool, if `source.credential_id` is set and the
 *      credential is `active`.
 *   2. Inline `source.config.cookie` / `source.config.userAgent` (legacy mode,
 *      kept working so existing rows don't need migration).
 *
 * Also bumps `credentials.last_used_at` so the credential pool UI can show
 * which sessions are still being exercised.
 */
export async function resolveAuth(source: SourceRow): Promise<ResolvedAuth> {
  if (source.credential_id) {
    const rows = await query<{ cookie: string | null; user_agent: string | null; status: string }>(
      `SELECT cookie, user_agent, status FROM credentials WHERE id = $1`,
      [source.credential_id],
    );
    const row = rows[0];
    if (row && row.status === 'active') {
      // Best-effort touch — don't fail the fetch if this UPDATE errors.
      query(`UPDATE credentials SET last_used_at = NOW() WHERE id = $1`, [source.credential_id])
        .catch(() => {});
      return {
        cookie: row.cookie ?? undefined,
        userAgent: row.user_agent ?? undefined,
        credentialId: source.credential_id,
      };
    }
  }
  const cfg = source.config ?? {};
  return {
    cookie: typeof cfg.cookie === 'string' ? cfg.cookie : undefined,
    userAgent: typeof cfg.userAgent === 'string' ? cfg.userAgent : undefined,
  };
}

/** Mark a credential as auth-failed so the workbench can banner it and the
 *  pool UI can show the failure. Bumps `last_auth_check_at` either way. */
export async function recordAuthOutcome(credentialId: string | undefined, ok: boolean): Promise<void> {
  if (!credentialId) return;
  await query(
    `UPDATE credentials
       SET last_auth_check_at = NOW(),
           last_auth_ok = $2,
           status = CASE WHEN $2 THEN status
                         WHEN status = 'active' THEN 'expired'
                         ELSE status END
     WHERE id = $1`,
    [credentialId, ok],
  ).catch(() => {});
}
