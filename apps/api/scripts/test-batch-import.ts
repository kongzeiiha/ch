/**
 * Integration test for POST /admin/sources/batch-import.
 *
 * Spins up the running API (must already be on :4000), drives the endpoint
 * against a disposable platform tag, asserts row state in DB, and cleans up.
 *
 * Run from repo root:
 *   pnpm --filter @ch/api exec tsx scripts/test-batch-import.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });

const { query } = await import('@ch/db');
const { getQueue, QUEUE_NAMES } = await import('@ch/agents');

const API = process.env.API_URL ?? 'http://localhost:4000';
const TAG = `__test_batch_${Date.now()}`;
// Use a fake-looking handle prefix so we can wipe by LIKE without touching real data.
const handle = (n: number) => `${TAG}_h${n}`;

let pass = 0, fail = 0;
const errs: string[] = [];
const aok = (cond: unknown, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); pass++; } else { console.log(`  ✗ ${msg}`); errs.push(msg); fail++; } };

async function cleanup() {
  console.log('\n[cleanup] dropping batch-import test rows');
  await query(`DELETE FROM sources WHERE platform='x' AND external_id LIKE $1`, [`${TAG}%`]).catch(() => {});
  await query(`DELETE FROM sources WHERE platform='reddit' AND external_id LIKE $1`, [`${TAG}%`]).catch(() => {});
  // Drain any leftover ingest jobs we triggered for the disposable handles.
  const q = getQueue(QUEUE_NAMES.ingestion);
  const jobs = await q.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 200);
  for (const j of jobs) {
    if (typeof j.id === 'string' && j.id.includes('batch') && j.id.includes(TAG)) {
      await j.remove().catch(() => {});
    }
  }
}

async function postBatch(body: unknown) {
  const r = await fetch(`${API}/admin/sources/batch-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function testInvalidPlatform() {
  console.log('\n[test 1] invalid platform → 400');
  const r = await postBatch({ platform: 'rss', handles: ['x'] });
  aok(r.status === 400, `400 returned (got ${r.status})`);
  aok(/platform/.test(r.body?.error ?? ''), `error mentions platform (${r.body?.error})`);
}

async function testEmptyHandles() {
  console.log('\n[test 2] empty handles → 400');
  const r = await postBatch({ platform: 'x', handles: [], sharedConfig: { cookie: 'auth_token=x; ct0=y' } });
  aok(r.status === 400, `400 returned (got ${r.status})`);
}

async function testMissingCookie() {
  console.log('\n[test 3] X without cookie → all entries fail with helpful reason');
  const r = await postBatch({
    platform: 'x',
    handles: [handle(1)],
    sharedConfig: { limit: 5 },
  });
  aok(r.status === 200, `endpoint returns 200 even when individual entries fail (got ${r.status})`);
  aok(r.body?.failed?.length === 1, `1 failure recorded`);
  aok(/cookie/.test(r.body?.failed?.[0]?.reason ?? ''), `failure reason mentions cookie`);
  aok(r.body?.created?.length === 0, `0 created`);
}

async function testHappyPath() {
  console.log('\n[test 4] happy path: 3 X handles, with cookie, no fetch trigger');
  const r = await postBatch({
    platform: 'x',
    handles: [handle(2), handle(3), `@${handle(4)}`, handle(2) /* dup */, '   '],
    sharedConfig: { cookie: 'auth_token=fake; ct0=fakecsrf', limit: 5, skipRetweets: true },
    triggerFetch: false,
  });
  aok(r.status === 200, `status 200 (got ${r.status})`);
  aok(r.body?.created?.length === 3, `3 created (deduped + blank dropped) (got ${r.body?.created?.length})`);
  aok(r.body?.updated?.length === 0, `0 updated`);
  aok(r.body?.failed?.length === 0, `0 failed`);

  // Verify DB rows
  const rows = await query<{ external_id: string; name: string; url: string; status: string; cfg: any }>(
    `SELECT external_id, name, url, status, config AS cfg FROM sources
     WHERE platform='x' AND external_id LIKE $1 ORDER BY external_id`,
    [`${TAG}%`],
  );
  aok(rows.length === 3, `3 rows in DB`);
  aok(rows.every(r => r.status === 'active'), `all rows active`);
  aok(rows.every(r => r.name.startsWith('@')), `names prefixed with @`);
  aok(rows.every(r => r.url.startsWith('https://x.com/')), `URLs are x.com profiles`);
  aok(rows.every(r => r.cfg.mode === 'user' && r.cfg.screenName && r.cfg.cookie === 'auth_token=fake; ct0=fakecsrf'),
    `each row has shared cookie + per-handle screenName + mode=user`);
  aok(rows.every(r => r.cfg.skipRetweets === true && r.cfg.limit === 5), `shared config knobs propagated`);
  // Normalization: '@H4' should be lowercased and stripped → handle(4)
  aok(rows.some(r => r.external_id === handle(4).toLowerCase()), `@-prefix stripped, lowercased`);
}

async function testRerunUpdates() {
  console.log('\n[test 5] re-import same handles → updates, not duplicates');
  const r = await postBatch({
    platform: 'x',
    handles: [handle(2), handle(3), handle(4)],
    sharedConfig: { cookie: 'auth_token=NEW; ct0=NEWCSRF', limit: 10 },
    triggerFetch: false,
  });
  aok(r.body?.created?.length === 0, `0 created (already exist)`);
  aok(r.body?.updated?.length === 3, `3 updated (got ${r.body?.updated?.length})`);

  const [row] = await query<{ cfg: any }>(
    `SELECT config AS cfg FROM sources WHERE platform='x' AND external_id=$1`,
    [handle(2).toLowerCase()],
  );
  aok(row.cfg.cookie === 'auth_token=NEW; ct0=NEWCSRF', `cookie was updated to new value`);
  aok(row.cfg.limit === 10, `limit updated 5→10`);
}

async function testTriggerFetch() {
  console.log('\n[test 6] triggerFetch=true enqueues an ingest job per source');
  const before = (await getQueue(QUEUE_NAMES.ingestion).getJobCounts('waiting', 'active', 'delayed')).waiting ?? 0;
  const r = await postBatch({
    platform: 'x',
    handles: [handle(5)],
    sharedConfig: { cookie: 'auth_token=fake; ct0=fake' },
    triggerFetch: true,
  });
  aok(r.body?.created?.length + r.body?.updated?.length === 1, `1 source created/updated`);
  // Look at queued jobs and find one whose data.sourceId matches our row.
  const sid = r.body?.created?.[0]?.sourceId ?? r.body?.updated?.[0]?.sourceId;
  const jobs = await getQueue(QUEUE_NAMES.ingestion).getJobs(['waiting', 'delayed', 'active'], 0, 200);
  const matched = jobs.some(j => (j.data as any)?.sourceId === sid && (j.data as any)?.kind === 'ingest');
  aok(matched, `ingest job enqueued for sourceId=${sid?.slice(0, 8)}…`);
}

async function testRedditBatch() {
  console.log('\n[test 8] reddit batch: 3 subreddits with sort/time, /r/ prefix stripped');
  const r = await postBatch({
    platform: 'reddit',
    handles: [`${TAG}_sub1`, `r/${TAG}_sub2`, `/r/${TAG}_sub3`, `${TAG}_sub1` /* dup */],
    sharedConfig: { sort: 'top', time: 'week', limit: 50 },
    triggerFetch: false,
  });
  aok(r.status === 200, `status 200 (got ${r.status})`);
  aok(r.body?.created?.length === 3, `3 created (deduped) (got ${r.body?.created?.length})`);
  aok(r.body?.failed?.length === 0, `0 failed`);

  const rows = await query<{ external_id: string; name: string; url: string; cfg: any }>(
    `SELECT external_id, name, url, config AS cfg FROM sources
     WHERE platform='reddit' AND external_id LIKE $1 ORDER BY external_id`,
    [`${TAG}%`],
  );
  aok(rows.length === 3, `3 reddit rows in DB`);
  aok(rows.every(r => r.name.startsWith('r/')), `names prefixed r/`);
  aok(rows.every(r => r.url.startsWith('https://www.reddit.com/r/')), `URLs are reddit.com/r/`);
  aok(rows.every(r => typeof r.cfg.subreddit === 'string'), `each row has subreddit field (singular)`);
  aok(rows.every(r => r.cfg.sort === 'top' && r.cfg.time === 'week' && r.cfg.limit === 50),
    `shared sort/time/limit propagated`);
  // /r/ and /r prefix stripped
  aok(rows.some(r => r.external_id === `${TAG}_sub2`.toLowerCase()), `r/ prefix stripped`);
  aok(rows.some(r => r.external_id === `${TAG}_sub3`.toLowerCase()), `/r/ prefix stripped`);
}

async function testRedditValidatorAcceptsSingleSubreddit() {
  console.log('\n[test 9] validator: reddit with subreddit (singular) is valid');
  // Drive directly through the create-source endpoint to exercise validateSourceConfig
  const r = await fetch(`${API}/admin/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'reddit',
      external_id: `${TAG}_validator_single`,
      name: `r/${TAG}_validator_single`,
      url: 'https://www.reddit.com/r/x',
      config: { subreddit: 'EarthPorn', sort: 'top' },
    }),
  });
  aok(r.status === 200, `single subreddit form accepted (got ${r.status})`);
  // Cleanup
  await query(`DELETE FROM sources WHERE external_id=$1`, [`${TAG}_validator_single`]);
}

async function testCap() {
  console.log('\n[test 7] cap at 500 handles');
  const huge = Array.from({ length: 501 }, (_, i) => `${TAG}_huge${i}`);
  const r = await postBatch({
    platform: 'x', handles: huge, sharedConfig: { cookie: 'auth_token=x; ct0=y' },
  });
  aok(r.status === 400, `>500 rejected (got ${r.status})`);
  aok(/500/.test(r.body?.error ?? ''), `error mentions the 500 cap`);
}

async function main() {
  // Sanity: API up?
  const h = await fetch(`${API}/health`).then(r => r.ok).catch(() => false);
  if (!h) {
    console.error(`API at ${API} is not responding — start it first (pnpm --filter @ch/api dev).`);
    process.exit(2);
  }

  try {
    await testInvalidPlatform();
    await testEmptyHandles();
    await testMissingCookie();
    await testHappyPath();
    await testRerunUpdates();
    await testTriggerFetch();
    await testRedditBatch();
    await testRedditValidatorAcceptsSingleSubreddit();
    await testCap();
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
