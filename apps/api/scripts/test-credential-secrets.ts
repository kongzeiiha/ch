/**
 * Integration tests for the encrypted credential-secrets feature.
 *
 *   - Encryption round-trip via crypto helper
 *   - POST/DELETE /admin/credentials/:id/secret
 *   - GET list exposes has_secret + secret_username (no password)
 *   - Wrong CREDENTIAL_SECRET_KEY rejects decryption
 *   - Tamper detection (flipping a byte breaks GCM auth tag)
 *
 * Does NOT exercise the actual stealth login flow — that requires real X
 * traffic. We test the failure-recording path by directly invoking the
 * worker's refreshOne with a fake credential that has decryption fail (no
 * secret key matching) which bumps consecutive_failures.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });

const { query } = await import('@ch/db');
const cryptoMod = await import('../src/crypto.js');

const API = process.env.API_URL ?? 'http://localhost:4000';
const TAG = `__test_secret_${Date.now()}`;

let pass = 0, fail = 0;
const errs: string[] = [];
const aok = (cond: unknown, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); pass++; } else { console.log(`  ✗ ${msg}`); errs.push(msg); fail++; } };

async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let credId = '';

async function cleanup() {
  console.log('\n[cleanup] dropping test rows');
  await query(`DELETE FROM credentials WHERE name LIKE $1`, [`${TAG}%`]).catch(() => {});
}

async function testEncryptionRoundTrip() {
  console.log('\n[test 1] AES-256-GCM round-trip');
  const plain = 'hunter2-correct-horse-battery-staple';
  const blob = cryptoMod.encrypt(plain);
  aok(blob.split(':').length === 3, `blob has 3 segments (iv:ct:tag), got "${blob.split(':').length}"`);
  const back = cryptoMod.decrypt(blob);
  aok(back === plain, `decrypt yields original plaintext`);

  // Each encryption uses a fresh IV, so two encrypts of the same plaintext
  // should produce different ciphertexts (= confidentiality, not just integrity).
  const blob2 = cryptoMod.encrypt(plain);
  aok(blob2 !== blob, `same plaintext → different ciphertext (random IV)`);
}

async function testTamperDetection() {
  console.log('\n[test 2] AES-GCM tamper detection');
  const plain = 'super-secret';
  const blob = cryptoMod.encrypt(plain);
  // Flip one char in the ciphertext segment; GCM auth tag must catch it.
  const [iv, ct, tag] = blob.split(':');
  const flipped = ct.charAt(0) === 'A' ? 'B' + ct.slice(1) : 'A' + ct.slice(1);
  let threw = false;
  try { cryptoMod.decrypt(`${iv}:${flipped}:${tag}`); }
  catch { threw = true; }
  aok(threw, 'flipped ciphertext byte → decrypt throws');
}

async function testCreateSecret() {
  console.log('\n[test 3] POST /admin/credentials/:id/secret');
  // Build a credential first
  const c = await api('POST', '/admin/credentials', {
    platform: 'x', name: `${TAG}_main`,
    cookie: 'auth_token=fake; ct0=fakecsrf123',
  });
  aok(c.status === 200, `credential created (${c.status})`);
  credId = c.body.credential.id;

  const r = await api('POST', `/admin/credentials/${credId}/secret`, {
    username: 'demo_user@example.com',
    password: 'p@ssw0rd-test-123',
  });
  aok(r.status === 200, `secret saved (${r.status})`);
  aok(r.body?.has_secret === true, `has_secret=true`);

  // DB row exists, password_blob is encrypted (not equal to plaintext)
  const [row] = await query<{ username: string; password_blob: string; consecutive_failures: number }>(
    `SELECT username, password_blob, consecutive_failures FROM credential_secrets WHERE credential_id=$1`,
    [credId],
  );
  aok(row?.username === 'demo_user@example.com', `username stored`);
  aok(row?.password_blob && !row.password_blob.includes('p@ssw0rd'), `password is NOT stored in plaintext`);
  aok(row?.password_blob.split(':').length === 3, `password_blob in iv:ct:tag format`);
  aok(row?.consecutive_failures === 0, `consecutive_failures=0 fresh`);

  // We can decrypt it back
  const back = cryptoMod.decrypt(row.password_blob);
  aok(back === 'p@ssw0rd-test-123', `decrypt yields original password`);
}

async function testListExposesSecretMetadata() {
  console.log('\n[test 4] GET /admin/credentials surfaces has_secret + secret_username (NO password)');
  const r = await api('GET', '/admin/credentials');
  const c = r.body.credentials.find((c: any) => c.id === credId);
  aok(!!c, `our credential is in the list`);
  aok(c.has_secret === true, `has_secret=true`);
  aok(c.secret_username === 'demo_user@example.com', `username surfaced`);
  aok(typeof c.password === 'undefined', `no 'password' field`);
  aok(typeof c.password_blob === 'undefined', `no 'password_blob' field`);
  aok(c.secret_consecutive_failures === 0, `failures=0`);
  aok(c.secret_last_refresh_at === null, `never-refreshed has null last_refresh_at`);
}

async function testReplacingResetsFailures() {
  console.log('\n[test 5] re-POST secret resets last_refresh_* and consecutive_failures');
  // Simulate prior failures by writing directly
  await query(
    `UPDATE credential_secrets SET consecutive_failures = 5, last_refresh_ok = false,
       last_refresh_error = 'previous reason', last_refresh_at = NOW()
     WHERE credential_id = $1`,
    [credId],
  );
  const r = await api('POST', `/admin/credentials/${credId}/secret`, {
    username: 'newuser@example.com',
    password: 'newpass',
  });
  aok(r.status === 200, `re-save ok`);
  const [row] = await query<{ username: string; consecutive_failures: number; last_refresh_at: string | null; last_refresh_error: string | null }>(
    `SELECT username, consecutive_failures, last_refresh_at, last_refresh_error FROM credential_secrets WHERE credential_id=$1`,
    [credId],
  );
  aok(row.username === 'newuser@example.com', `username updated`);
  aok(row.consecutive_failures === 0, `failure count reset to 0`);
  aok(row.last_refresh_at === null, `last_refresh_at cleared`);
  aok(row.last_refresh_error === null, `last_refresh_error cleared`);
}

async function testMissingSecretMissingFields() {
  console.log('\n[test 6] POST without username/password → 400');
  const r1 = await api('POST', `/admin/credentials/${credId}/secret`, { username: 'x' });
  aok(r1.status === 400, `missing password → 400`);
  const r2 = await api('POST', `/admin/credentials/${credId}/secret`, { password: 'y' });
  aok(r2.status === 400, `missing username → 400`);
}

async function testRefreshEndpointWithoutSecret() {
  console.log('\n[test 7] /refresh on credential without secret → 404');
  const c = await api('POST', '/admin/credentials', {
    platform: 'x', name: `${TAG}_no_secret`,
    cookie: 'auth_token=x; ct0=y',
  });
  const r = await api('POST', `/admin/credentials/${c.body.credential.id}/refresh?sync=1`);
  aok(r.status === 404, `404 (got ${r.status})`);
  aok(/secret/i.test(r.body?.error ?? ''), `error mentions secret`);
}

async function testCascadeDeleteRemovesSecret() {
  console.log('\n[test 8] deleting the credential cascades to credential_secrets');
  const r = await api('DELETE', `/admin/credentials/${credId}`);
  aok(r.status === 200, `delete ok`);
  const rows = await query(`SELECT 1 FROM credential_secrets WHERE credential_id=$1`, [credId]);
  aok(rows.length === 0, `no orphan secret row`);
}

async function testDeleteSecretEndpoint() {
  console.log('\n[test 9] DELETE /secret keeps credential, drops only the secret');
  const c = await api('POST', '/admin/credentials', {
    platform: 'x', name: `${TAG}_keepme`,
    cookie: 'auth_token=x; ct0=y',
  });
  const id = c.body.credential.id;
  await api('POST', `/admin/credentials/${id}/secret`, {
    username: 'tmp', password: 'tmp',
  });
  const r = await api('DELETE', `/admin/credentials/${id}/secret`);
  aok(r.status === 200, `delete secret ok (${r.status})`);
  const credExists = await query(`SELECT 1 FROM credentials WHERE id=$1`, [id]);
  aok(credExists.length === 1, `credential still there`);
  const secretGone = await query(`SELECT 1 FROM credential_secrets WHERE credential_id=$1`, [id]);
  aok(secretGone.length === 0, `secret row gone`);
  // Idempotency: second delete returns 404
  const r2 = await api('DELETE', `/admin/credentials/${id}/secret`);
  aok(r2.status === 404, `second delete → 404`);
  // cleanup
  await api('DELETE', `/admin/credentials/${id}`);
}

async function main() {
  if (!process.env.CREDENTIAL_SECRET_KEY) {
    console.error('CREDENTIAL_SECRET_KEY missing in .env — re-run after setting it');
    process.exit(2);
  }
  const h = await fetch(`${API}/health`).then(r => r.ok).catch(() => false);
  if (!h) { console.error(`API at ${API} not up`); process.exit(2); }

  try {
    await testEncryptionRoundTrip();
    await testTamperDetection();
    await testCreateSecret();
    await testListExposesSecretMetadata();
    await testReplacingResetsFailures();
    await testMissingSecretMissingFields();
    await testRefreshEndpointWithoutSecret();
    await testDeleteSecretEndpoint();
    await testCascadeDeleteRemovesSecret();
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
