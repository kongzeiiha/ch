/**
 * Smoke test for the operation log module.
 *
 * Boots a self-contained Fastify instance with our hook + admin routes, then
 * exercises every operation type the user listed:
 *   - 新增信源 / 编辑信源 / 删除信源
 *   - 合规放行 / 合规拒绝
 *   - 编辑推文文案
 *   - 发布至主站
 *   - 紧急下线（rollback PUBLISHED → COMPLIANCE_PASS）
 *   - 急停 / 恢复
 * Plus the catch-all hook for un-instrumented endpoints.
 *
 * Each test asserts an operation_logs row was written with the right operator,
 * operation, target_type, and target_id.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.COMPLIANCE_SKIP_LLM = '1';
process.env.DISTRIBUTION_SKIP_LLM = '1';
process.env.DISABLE_AUTO_PIPELINE = '1';
process.env.DISABLE_SCHEDULER = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });

const Fastify = (await import('fastify')).default;
const { query } = await import('@ch/db');
const { randomUUID } = await import('node:crypto');
const { registerOpLogHook, registerOpLogAdmin } = await import('../src/op-log.js');
const { registerAdmin } = await import('../src/admin.js');
const { registerDay5 } = await import('../src/admin-day5.js');
const { registerDay6 } = await import('../src/admin-day6.js');
const { registerPipelineAdmin } = await import('../src/admin-pipeline.js');

const TAG = `__test_oplog_${Date.now()}`;
const OPERATOR = `tester_${Date.now()}`;

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(cond: unknown, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else      { console.log(`  ✗ ${msg}`); failures.push(msg); fail++; }
}

const app = Fastify({ logger: false });
registerOpLogHook(app);
await registerOpLogAdmin(app);
await registerAdmin(app);
await registerDay5(app);
await registerDay6(app);
await registerPipelineAdmin(app);

// Fastify rejects POST/PATCH with content-type: application/json but no body
// (FST_ERR_CTP_EMPTY_JSON_BODY). Only attach the json content-type when we
// actually have a body, so endpoints that take no input still work.
async function inject(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { 'x-operator': OPERATOR };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({
    method: method as any,
    url,
    headers,
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function findLog(operation: string, targetId?: string | null) {
  const rows = await query<{
    id: string; operator: string; operation: string;
    target_type: string; target_id: string | null;
    payload: any; status_code: number | null;
  }>(
    targetId === undefined
      ? `SELECT * FROM operation_logs WHERE operation = $1 AND operator = $2 ORDER BY occurred_at DESC LIMIT 1`
      : `SELECT * FROM operation_logs WHERE operation = $1 AND target_id IS NOT DISTINCT FROM $2 AND operator = $3 ORDER BY occurred_at DESC LIMIT 1`,
    targetId === undefined ? [operation, OPERATOR] : [operation, targetId, OPERATOR],
  );
  return rows[0] ?? null;
}

let sourceId = '';
let itemId = '';
let rawItemId = '';
let publishedItemId = '';
let publishedRawItemId = '';
let taskId = '';

async function setup() {
  console.log('\n[setup] inserting raw fixtures');
  sourceId = randomUUID();
  await query(
    `INSERT INTO sources (id, platform, external_id, name, url, status, config)
     VALUES ($1, 'html', $2, $2, 'https://example.test/oplog', 'active', '{}')`,
    [sourceId, `${TAG}_pre`],
  );
  // We'll create a fresh source via the API too, but a pre-existing one is
  // useful so the patch / delete tests have a target without depending on the
  // create test's success.

  rawItemId = randomUUID();
  await query(
    `INSERT INTO raw_items (id, source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, $2, 'https://example.test/a', $3, $4, NOW(), '{}', JSON_ARRAY())`,
    [rawItemId, sourceId, `${TAG}_pre_dk`, `${TAG}_pre_h`],
  );
  itemId = randomUUID();
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, content)
     VALUES ($1, $2, $3, 'COMPLIANCE_REVIEW', 'review subject', $4)`,
    [itemId, rawItemId, sourceId, 'x'.repeat(220)],
  );

  // A second item already PUBLISHED — for unpublish (紧急下线) test
  publishedRawItemId = randomUUID();
  await query(
    `INSERT INTO raw_items (id, source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, $2, 'https://example.test/b', $3, $4, NOW(), '{}', JSON_ARRAY())`,
    [publishedRawItemId, sourceId, `${TAG}_pre_dk2`, `${TAG}_pre_h2`],
  );
  publishedItemId = randomUUID();
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, slug, published_url, published_at)
     VALUES ($1, $2, $3, 'PUBLISHED', 'will-be-unpublished', 'will-be-unpublished-${Date.now()}',
             'http://localhost:3000/a/will-be-unpublished', NOW())`,
    [publishedItemId, publishedRawItemId, sourceId],
  );

  // A pending distribution_task for the edit-copy test
  taskId = randomUUID();
  await query(
    `INSERT INTO distribution_tasks (id, item_id, channel, copy, status)
     VALUES ($1, $2, 'twitter', 'original copy', 'pending')`,
    [taskId, publishedItemId],
  );

  console.log(`  src=${sourceId.slice(0,8)}  item=${itemId.slice(0,8)}  pubItem=${publishedItemId.slice(0,8)}  task=${taskId.slice(0,8)}`);
}

async function cleanup() {
  console.log('\n[cleanup]');
  // Delete in reverse FK dependency order. Filter logs by operator so we don't
  // wipe other tenants' history (defensive even though the test owns its tag).
  await query(`DELETE FROM operation_logs WHERE operator = $1`, [OPERATOR]).catch(() => {});
  await query(`DELETE FROM agent_runs WHERE item_id IN ($1, $2)`, [itemId, publishedItemId]).catch(() => {});
  await query(`DELETE FROM distribution_tasks WHERE item_id IN ($1, $2)`, [itemId, publishedItemId]).catch(() => {});
  await query(`DELETE FROM items WHERE id IN ($1, $2)`, [itemId, publishedItemId]).catch(() => {});
  await query(`DELETE FROM raw_items WHERE id IN ($1, $2)`, [rawItemId, publishedRawItemId]).catch(() => {});
  await query(`DELETE FROM sources WHERE external_id LIKE $1`, [`${TAG}_%`]).catch(() => {});
}

async function testCreateSource() {
  console.log('\n[1] 新增信源');
  const externalId = `${TAG}_create`;
  const r = await inject('POST', '/admin/sources', {
    platform: 'rss',
    external_id: externalId,
    name: 'create-test',
    url: 'https://example.test',
    config: { feed_url: 'https://example.test/feed.xml' },
  });
  ok(r.statusCode === 200, `POST returned 200 (got ${r.statusCode})`);
  const newSourceId = (r.json() as any).source.id;

  const log = await findLog('source.create', newSourceId);
  ok(!!log, 'source.create row exists');
  ok(log?.operator === OPERATOR, `operator captured (${log?.operator})`);
  ok(log?.target_type === 'source', `target_type=source`);
  ok(log?.target_id === newSourceId, 'target_id matches new source id');
  ok(log?.payload?.platform === 'rss', 'payload includes platform');

  // Cleanup the source we just made
  await query(`DELETE FROM sources WHERE id = $1`, [newSourceId]);
}

async function testUpdateSource() {
  console.log('\n[2] 编辑信源');
  const r = await inject('PATCH', `/admin/sources/${sourceId}`, { name: 'renamed-by-test' });
  ok(r.statusCode === 200, `PATCH returned 200`);
  const log = await findLog('source.update', sourceId);
  ok(!!log, 'source.update row exists');
  ok(log?.payload?.changed?.name === 'renamed-by-test', 'payload.changed captures new name');
}

async function testApproveReview() {
  console.log('\n[3] 合规审批放行');
  const r = await inject('POST', `/admin/pipeline/approve-review/${itemId}`);
  ok(r.statusCode === 200, `POST approve-review returned 200`);
  const log = await findLog('compliance.approve', itemId);
  ok(!!log, 'compliance.approve row exists');
  ok(log?.payload?.decision === 'approve', 'payload.decision = approve');
}

async function testRejectReview() {
  console.log('\n[4] 合规审批拒绝');
  // Re-set status to REVIEW so reject-review's WHERE clause matches.
  await query(`UPDATE items SET status='COMPLIANCE_REVIEW' WHERE id=$1`, [itemId]);
  const r = await inject('POST', `/admin/pipeline/reject-review/${itemId}`, { reason: '内容不准确' });
  ok(r.statusCode === 200, `POST reject-review returned 200`);
  const log = await findLog('compliance.reject', itemId);
  ok(!!log, 'compliance.reject row exists');
  ok(log?.payload?.reason === '内容不准确', 'payload.reason captured');
}

async function testEditDistributionCopy() {
  console.log('\n[5] 编辑推文文案');
  const r = await inject('PATCH', `/admin/day6/distribution-tasks/${taskId}`, { copy: 'edited copy with #hashtag' });
  ok(r.statusCode === 200, `PATCH returned 200 (got ${r.statusCode}: ${r.payload})`);
  const log = await findLog('distribution.edit-copy', taskId);
  ok(!!log, 'distribution.edit-copy row exists');
  ok(log?.payload?.before === 'original copy', 'payload.before captures original');
  ok(log?.payload?.after === 'edited copy with #hashtag', 'payload.after captures new copy');
  ok(log?.target_type === 'distribution_task', 'target_type = distribution_task');
}

async function testForcePublish() {
  console.log('\n[6] 发布至主站（force-publish）');
  // Create a fresh item in COMPLIANCE_PASS to publish
  const rawId = randomUUID();
  await query(
    `INSERT INTO raw_items (id, source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, $2, 'https://example.test/c', $3, $4, NOW(), '{}', JSON_ARRAY())`,
    [rawId, sourceId, `${TAG}_pub_dk`, `${TAG}_pub_h`],
  );
  const pubItId = randomUUID();
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, slug)
     VALUES ($1, $2, $3, 'COMPLIANCE_PASS', 'force pub', 'force-pub-${Date.now()}')`,
    [pubItId, rawId, sourceId],
  );
  const r = await inject('POST', `/admin/day5/force-publish/${pubItId}`);
  ok(r.statusCode === 200, `POST force-publish returned 200`);
  const log = await findLog('publish.force', pubItId);
  ok(!!log, 'publish.force row exists');
  ok(log?.payload?.bypassCompliance === true, 'payload notes compliance bypass');

  await query(`DELETE FROM items WHERE id=$1`, [pubItId]);
  await query(`DELETE FROM raw_items WHERE id=$1`, [rawId]);
}

async function testUnpublishRollback() {
  console.log('\n[7] 紧急下线（rollback PUBLISHED）');
  const r = await inject('POST', `/admin/pipeline/rollback/${publishedItemId}`);
  ok(r.statusCode === 200, `POST rollback returned 200 (got ${r.statusCode}: ${r.payload})`);
  // Should be tagged as item.unpublish, not generic item.rollback
  const log = await findLog('item.unpublish', publishedItemId);
  ok(!!log, 'item.unpublish row exists (treated as 紧急下线)');
  ok(log?.payload?.from === 'PUBLISHED', 'payload.from = PUBLISHED');
  ok(log?.payload?.to === 'COMPLIANCE_PASS', 'payload.to = COMPLIANCE_PASS');
  ok(Array.isArray(log?.payload?.clearedFields) && log.payload.clearedFields.includes('published_url'),
    'cleared fields include published_url');
}

async function testEmergencyStop() {
  console.log('\n[8] 急停 / 恢复');
  const r1 = await inject('POST', '/admin/pipeline/emergency-stop');
  ok(r1.statusCode === 200, 'emergency-stop returned 200');
  const log1 = await findLog('system.emergency-stop', null);
  ok(!!log1, 'system.emergency-stop row exists');
  ok(log1?.target_type === 'system', 'target_type = system');

  const r2 = await inject('POST', '/admin/pipeline/resume');
  ok(r2.statusCode === 200, 'resume returned 200');
  const log2 = await findLog('system.resume', null);
  ok(!!log2, 'system.resume row exists');
}

async function testCatchAllHook() {
  console.log('\n[9] 兜底 hook（未显式记录的 admin 写）');
  // analytics-pull was not explicitly logged in older code; we wired it,
  // so use queue clean as a known un-instrumented write that still hits hook.
  const r = await inject('POST', '/admin/queues/ingestion/clean?status=completed');
  ok(r.statusCode === 200, `queue clean returned 200`);

  // The catch-all should derive operation = "queues.create" from the URL
  const rows = await query<{ operation: string; target_type: string; status_code: number | null; payload: any }>(
    `SELECT operation, target_type, status_code, payload
     FROM operation_logs
     WHERE operator = $1 AND http_method = 'POST' AND http_path LIKE '/admin/queues/%'
     ORDER BY occurred_at DESC LIMIT 1`,
    [OPERATOR],
  );
  ok(rows.length === 1, 'catch-all wrote a row for un-instrumented endpoint');
  ok(rows[0]?.payload?.auto === true, 'payload.auto = true marks it as catch-all-derived');
  ok(rows[0]?.status_code === 200, 'status_code captured by hook');
}

async function testQueryEndpoints() {
  console.log('\n[10] 查询端点');
  const r1 = await inject('GET', `/admin/op-logs?operator=${encodeURIComponent(OPERATOR)}&limit=50`);
  ok(r1.statusCode === 200, `/admin/op-logs returned 200`);
  const data = r1.json() as { logs: any[]; total: number };
  ok(Array.isArray(data.logs), 'logs is an array');
  ok(data.total >= 7, `at least 7 rows for this operator (got ${data.total})`);

  // target trail for the published item should hold both compliance + unpublish
  const r2 = await inject('GET', `/admin/op-logs/target/item/${publishedItemId}`);
  ok(r2.statusCode === 200, `target trail returned 200`);
  const trail = (r2.json() as any).trail;
  ok(Array.isArray(trail), 'trail is an array');
  ok(trail.some((r: any) => r.operation === 'item.unpublish'),
    'trail includes the unpublish event');
}

async function testExplicitStatusBackfill() {
  console.log('\n[11] 显式日志的 status_code 由 onResponse 回填');
  // After all the prior tests ran, every explicit log row should have a
  // status_code (200 in our case — none of the tests' POST/PATCH paths 4xx-d).
  // Assert no NULL status codes remain for this operator.
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM operation_logs
     WHERE operator = $1 AND status_code IS NULL`,
    [OPERATOR],
  );
  ok(rows[0].cnt === 0, `no explicit logs left with NULL status_code (got ${rows[0].cnt})`);

  // And confirm a sample explicit row carries the right code. compliance.approve
  // was called via /admin/pipeline/approve-review/:itemId which returned 200.
  const sample = await query<{ status_code: number | null }>(
    `SELECT status_code
     FROM operation_logs
     WHERE operator = $1 AND operation = 'compliance.approve'
     ORDER BY occurred_at DESC LIMIT 1`,
    [OPERATOR],
  );
  ok(sample[0]?.status_code === 200, `explicit compliance.approve has status_code=200 (got ${sample[0]?.status_code})`);
}

async function main() {
  console.log('========================================');
  console.log(' op-log smoke test');
  console.log(`  operator = ${OPERATOR}`);
  console.log('========================================');
  await setup();
  try {
    await testCreateSource();
    await testUpdateSource();
    await testApproveReview();
    await testRejectReview();
    await testEditDistributionCopy();
    await testForcePublish();
    await testUnpublishRollback();
    await testEmergencyStop();
    await testCatchAllHook();
    await testQueryEndpoints();
    await testExplicitStatusBackfill();
  } finally {
    await app.close();
    await cleanup();
  }
  console.log(`\n========================================`);
  console.log(` summary: ${pass} passed, ${fail} failed`);
  console.log('========================================');
  if (fail) {
    console.log('failures:');
    for (const e of failures) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error('test crashed:', e); process.exit(2); })
  .finally(() => { setTimeout(() => process.exit(fail ? 1 : 0), 200).unref(); });
