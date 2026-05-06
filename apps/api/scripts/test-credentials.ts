/**
 * Integration test for the shared credential pool:
 *   - CRUD /admin/credentials
 *   - batch-import using `credentialId`
 *   - resolveAuth: source with credential_id picks up cookie from the pool
 *   - rotation: updating the credential's cookie propagates to all sources
 *
 * Run from repo root:
 *   pnpm --filter @ch/api exec tsx scripts/test-credentials.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });

const { query } = await import('@ch/db');
const { resolveAuth } = await import('../src/workers/ingestion/adapters/auth.js');

const API = process.env.API_URL ?? 'http://localhost:4000';
const TAG = `__test_cred_${Date.now()}`;

let pass = 0, fail = 0;
const errs: string[] = [];
const aok = (cond: unknown, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); pass++; } else { console.log(`  ✗ ${msg}`); errs.push(msg); fail++; } };

async function cleanup() {
  console.log('\n[cleanup] dropping test rows');
  await query(`DELETE FROM sources WHERE platform='x' AND external_id LIKE $1`, [`${TAG}%`]).catch(() => {});
  await query(`DELETE FROM credentials WHERE name LIKE $1`, [`${TAG}%`]).catch(() => {});
}

async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let credId = '';

async function testCreateCredential() {
  console.log('\n[test 1] create X credential');
  const r = await api('POST', '/admin/credentials', {
    platform: 'x',
    name: `${TAG}_main`,
    cookie: 'auth_token=fake; ct0=fakecsrf123',
    user_agent: 'Mozilla/5.0 (test)',
  });
  aok(r.status === 200, `created (got ${r.status})`);
  aok(r.body?.credential?.id, `credential id returned`);
  aok(r.body?.credential?.cookie_len > 0, `cookie_len > 0 (don't return raw cookie)`);
  aok(typeof r.body?.credential?.cookie === 'undefined', `raw cookie NOT returned in response`);
  credId = r.body.credential.id;
}

async function testRejectMissingCt0() {
  console.log('\n[test 2] X credential without ct0 rejected');
  const r = await api('POST', '/admin/credentials', {
    platform: 'x',
    name: `${TAG}_nocsrf`,
    cookie: 'auth_token=onlythis; somethingelse=value',
  });
  aok(r.status === 400, `400 rejected (got ${r.status})`);
  aok(/ct0/.test(r.body?.error ?? ''), `error mentions ct0`);
}

async function testListHidesCookie() {
  console.log('\n[test 3] GET /admin/credentials does not return raw cookie');
  const r = await api('GET', '/admin/credentials');
  aok(r.status === 200, `200`);
  const ours = r.body?.credentials?.find((c: any) => c.id === credId);
  aok(!!ours, `our credential is in the list`);
  aok(typeof ours?.cookie === 'undefined', `cookie field absent in list response`);
  aok(typeof ours?.cookie_len === 'number', `cookie_len exposed`);
  aok(ours?.source_count === 0, `source_count=0 (no sources reference yet)`);
}

async function testBatchImportWithCredentialId() {
  console.log('\n[test 4] batch-import with credentialId — no inline cookie needed');
  const r = await api('POST', '/admin/sources/batch-import', {
    platform: 'x',
    handles: [`${TAG}_h1`, `${TAG}_h2`],
    sharedConfig: { limit: 5 },          // notice: no cookie here
    credentialId: credId,
    triggerFetch: false,
  });
  aok(r.status === 200, `status 200 (got ${r.status})`);
  aok(r.body?.created?.length === 2, `2 created (got ${r.body?.created?.length})`);
  aok(r.body?.failed?.length === 0, `0 failed`);

  // Sources should carry credential_id and NOT have cookie inlined into config
  const rows = await query<{ id: string; credential_id: string | null; cfg: any }>(
    `SELECT id, credential_id, config AS cfg FROM sources
     WHERE platform='x' AND external_id LIKE $1`,
    [`${TAG}%`],
  );
  aok(rows.every(r => r.credential_id === credId), `all rows reference credentialId`);
  aok(rows.every(r => typeof r.cfg.cookie === 'undefined'), `inline cookie NOT stored in source.config`);
}

async function testResolveAuthFromCredential() {
  console.log('\n[test 5] resolveAuth picks cookie from pool when credential_id set');
  const [src] = await query<{ id: string; platform: string; external_id: string; name: string; url: string; config: any; credential_id: string | null }>(
    `SELECT id, platform, external_id, name, url, config, credential_id
     FROM sources WHERE platform='x' AND external_id=$1`,
    [`${TAG}_h1`],
  );
  const auth = await resolveAuth(src as any);
  aok(auth.cookie === 'auth_token=fake; ct0=fakecsrf123', `cookie resolved from pool`);
  aok(auth.userAgent === 'Mozilla/5.0 (test)', `UA resolved from pool`);
  aok(auth.credentialId === credId, `credentialId surfaced`);

  // resolveAuth should also bump last_used_at
  await new Promise(r => setTimeout(r, 100));
  const [c] = await query<{ last_used_at: string | null }>(
    `SELECT last_used_at FROM credentials WHERE id=$1`,
    [credId],
  );
  aok(!!c.last_used_at, `last_used_at touched`);
}

async function testRotation() {
  console.log('\n[test 6] rotating credential cookie propagates to all bound sources');
  const r = await api('PATCH', `/admin/credentials/${credId}`, {
    cookie: 'auth_token=NEW_TOKEN; ct0=NEWCSRF',
  });
  aok(r.status === 200, `patch ok`);
  aok(r.body?.credential?.cookie_len, `cookie_len returned`);

  // resolveAuth on either source should now see the new cookie — without
  // touching the source rows at all.
  const [src] = await query<{ id: string; platform: string; external_id: string; name: string; url: string; config: any; credential_id: string | null }>(
    `SELECT id, platform, external_id, name, url, config, credential_id
     FROM sources WHERE platform='x' AND external_id=$1`,
    [`${TAG}_h2`],
  );
  const auth = await resolveAuth(src as any);
  aok(auth.cookie === 'auth_token=NEW_TOKEN; ct0=NEWCSRF', `rotation visible on second source without touching sources table`);
}

async function testInactiveCredentialFallback() {
  console.log('\n[test 7] credential marked expired → resolveAuth falls back to inline cookie');
  // Mark it expired, plant an inline cookie in source.config to verify fallback
  await api('PATCH', `/admin/credentials/${credId}`, { status: 'expired' });
  await query(
    `UPDATE sources SET config = JSON_MERGE_PATCH(config, '{"cookie":"INLINE_FALLBACK; ct0=x"}')
     WHERE platform='x' AND external_id=$1`,
    [`${TAG}_h1`],
  );
  const [src] = await query<{ id: string; platform: string; external_id: string; name: string; url: string; config: any; credential_id: string | null }>(
    `SELECT id, platform, external_id, name, url, config, credential_id
     FROM sources WHERE platform='x' AND external_id=$1`,
    [`${TAG}_h1`],
  );
  const auth = await resolveAuth(src as any);
  aok(auth.cookie === 'INLINE_FALLBACK; ct0=x', `fell back to inline config.cookie`);
  aok(auth.credentialId === undefined, `no credentialId reported when falling back`);

  // Restore credential to active for downstream tests
  await api('PATCH', `/admin/credentials/${credId}`, { status: 'active' });
}

async function testCannotMixPlatforms() {
  console.log('\n[test 8] credentialId platform must match import platform');
  const r = await api('POST', '/admin/sources/batch-import', {
    platform: 'reddit',
    handles: ['EarthPorn'],
    credentialId: credId,
    triggerFetch: false,
  });
  aok(r.status === 400, `mismatch rejected (got ${r.status})`);
  aok(/platform/.test(r.body?.error ?? ''), `error mentions platform mismatch`);
}

async function testDeleteCredentialDetachesSources() {
  console.log('\n[test 9] delete credential → ON DELETE SET NULL on sources');
  const before = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM sources WHERE credential_id=$1`,
    [credId],
  );
  aok(before[0].cnt > 0, `sources reference credential before delete`);
  const r = await api('DELETE', `/admin/credentials/${credId}`);
  aok(r.status === 200, `deleted (got ${r.status})`);
  const after = await query<{ cnt: number; null_cnt: number }>(
    `SELECT COUNT(*) AS cnt,
            SUM(CASE WHEN credential_id IS NULL THEN 1 ELSE 0 END) AS null_cnt
     FROM sources WHERE platform='x' AND external_id LIKE $1`,
    [`${TAG}%`],
  );
  aok(after[0].null_cnt === after[0].cnt, `all referencing sources had credential_id set to NULL`);
}

async function main() {
  const h = await fetch(`${API}/health`).then(r => r.ok).catch(() => false);
  if (!h) { console.error(`API at ${API} not up`); process.exit(2); }

  try {
    await testCreateCredential();
    await testRejectMissingCt0();
    await testListHidesCookie();
    await testBatchImportWithCredentialId();
    await testResolveAuthFromCredential();
    await testRotation();
    await testInactiveCredentialFallback();
    await testCannotMixPlatforms();
    await testDeleteCredentialDetachesSources();
  } finally {
    await cleanup();
  }
  console.log(`\n=== summary: ${pass} passed, ${fail} failed ===`);
  if (fail) {
    for (const e of errs) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main()
  .catch(e => { console.error(e); process.exit(2); })
  .finally(() => { setTimeout(() => process.exit(0), 200).unref(); });
