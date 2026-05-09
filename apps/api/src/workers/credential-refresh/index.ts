import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { decrypt } from '../../crypto.js';
import { loginToX, type LoginResult } from './x-login.js';

/**
 * Credential auto-refresh worker.
 *
 * Two job kinds:
 *   - 'scan'         (no payload) — find expired credentials that have a
 *                                   stored secret, enqueue a 'refresh-one'
 *                                   for each (deduped by jobId).
 *   - 'refresh-one'  ({credentialId}) — decrypt password, run the stealth
 *                                   X login flow, on success rotate the
 *                                   credential's cookie back to active.
 *
 * Failure handling:
 *   - bumps consecutive_failures
 *   - records reason in last_refresh_error
 *   - after 3 consecutive failures, sets credential.status='revoked' so the
 *     workbench surfaces it as needing human attention
 *
 * The scan kind is enqueued by a setInterval tick in scheduler.ts so we don't
 * need an external cron.
 */

export type CredentialRefreshJob =
  | { kind: 'scan' }
  | { kind: 'refresh-one'; credentialId: string };

const MAX_CONSECUTIVE_FAILURES = 3;

interface SecretRow {
  credential_id: string;
  username: string;
  password_blob: string;
  consecutive_failures: number;
  cred_platform: string;
}

async function scan(): Promise<{ enqueued: number }> {
  // Pick credentials that:
  //   - are non-active (expired or revoked)
  //   - have a secret attached
  //   - haven't blown past the failure budget
  // We use jobId based on credentialId so multiple scan ticks coalesce.
  const candidates = await query<{ credential_id: string }>(
    `SELECT cs.credential_id
     FROM credential_secrets cs
     JOIN credentials c ON c.id = cs.credential_id
     WHERE c.status <> 'active'
       AND cs.consecutive_failures < $1`,
    [MAX_CONSECUTIVE_FAILURES],
  );
  const q = getQueue<CredentialRefreshJob>(QUEUE_NAMES.credentialRefresh);
  let enqueued = 0;
  for (const { credential_id } of candidates) {
    await q.add(
      'refresh-one',
      { kind: 'refresh-one', credentialId: credential_id },
      // removeOnComplete frees the deterministic jobId on success so the
      // next scan can re-queue this credential; without it the historical
      // refresh__<id> stays in `completed` for 7 days and silently blocks
      // re-adds, freezing future refreshes for that credential.
      { jobId: `refresh__${credential_id}`, removeOnComplete: true },
    );
    enqueued++;
  }
  return { enqueued };
}

export async function refreshOne(credentialId: string): Promise<{
  ok: boolean;
  reason?: string;
  detail?: string;
  durationMs?: number;
  /** Base64-encoded PNG of the page at the moment the login failed. Only
   * populated on failure; the workbench renders it so the user can SEE what
   * X actually presented (challenge page / 2FA / "verify identity" etc.)
   * instead of guessing from the textual reason. */
  screenshotBase64?: string;
}> {
  const rows = await query<SecretRow>(
    `SELECT cs.credential_id, cs.username, cs.password_blob, cs.consecutive_failures,
            c.platform AS cred_platform
     FROM credential_secrets cs
     JOIN credentials c ON c.id = cs.credential_id
     WHERE cs.credential_id = $1`,
    [credentialId],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not-found', detail: 'no secret stored for this credential' };
  if (row.cred_platform !== 'x') {
    return { ok: false, reason: 'unsupported-platform', detail: `auto-refresh only supported for platform=x (got ${row.cred_platform})` };
  }

  let password: string;
  try {
    password = decrypt(row.password_blob);
  } catch (e: any) {
    await recordFailure(credentialId, 'unknown', `decrypt failed: ${e?.message}`);
    return { ok: false, reason: 'decrypt-failed', detail: e?.message };
  }

  const result: LoginResult = await loginToX({ username: row.username, password });

  if (result.ok) {
    await query(
      `UPDATE credentials
         SET cookie = $2,
             user_agent = $3,
             status = 'active',
             last_auth_check_at = NOW(),
             last_auth_ok = true
       WHERE id = $1`,
      [credentialId, result.cookie, result.userAgent],
    );
    await query(
      `UPDATE credential_secrets
         SET last_refresh_at = NOW(),
             last_refresh_ok = true,
             last_refresh_error = NULL,
             consecutive_failures = 0
       WHERE credential_id = $1`,
      [credentialId],
    );
    return { ok: true, durationMs: result.durationMs };
  }

  await recordFailure(credentialId, result.reason, result.detail);
  return {
    ok: false,
    reason: result.reason,
    detail: result.detail,
    durationMs: result.durationMs,
    screenshotBase64: result.screenshotPng?.toString('base64'),
  };
}

async function recordFailure(credentialId: string, reason: string, detail: string): Promise<void> {
  // Bump failure count atomically; if we've hit the budget, also flip the
  // credential to 'revoked' so the scan stops touching it and the workbench
  // shows a hard error.
  await query(
    `UPDATE credential_secrets
       SET last_refresh_at = NOW(),
           last_refresh_ok = false,
           last_refresh_error = $2,
           consecutive_failures = consecutive_failures + 1
     WHERE credential_id = $1`,
    [credentialId, `${reason}: ${detail}`.slice(0, 300)],
  );
  const rows = await query<{ consecutive_failures: number }>(
    `SELECT consecutive_failures FROM credential_secrets WHERE credential_id = $1`,
    [credentialId],
  );
  const failures = rows[0]?.consecutive_failures ?? 0;
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    await query(
      `UPDATE credentials SET status = 'revoked', last_auth_check_at = NOW(), last_auth_ok = false
       WHERE id = $1`,
      [credentialId],
    );
  }
}

export function startCredentialRefreshWorker() {
  return startWorker<CredentialRefreshJob>(
    QUEUE_NAMES.credentialRefresh,
    async (job: Job<CredentialRefreshJob>) => {
      const data = job.data;
      if (data.kind === 'scan') {
        return withRun({ agent: 'credential-refresh:scan' }, async () => {
          const out = await scan();
          return { output: out };
        });
      }
      if (data.kind === 'refresh-one') {
        return withRun(
          { agent: 'credential-refresh', inputHash: data.credentialId },
          async () => {
            const out = await refreshOne(data.credentialId);
            // Throw on failure so BullMQ marks the job failed; consecutive_failures
            // is already bumped inside refreshOne.
            if (!out.ok) throw new Error(`${out.reason}: ${out.detail ?? ''}`);
            return { output: out };
          },
        );
      }
      throw new Error(`unknown credential-refresh job kind: ${(data as any).kind}`);
    },
    { concurrency: 1 }, // serialize logins — too many in flight will trigger rate limits
  );
}
