/**
 * Integration smoke-test for the merged classify-title agent.
 *
 * Uses rule-based fallback (CLASSIFICATION_SKIP_LLM=1, TITLE_SKIP_LLM=1) so we
 * don't depend on Groq being up. Creates a disposable source + raw_item + item,
 * runs every interesting code path, asserts side-effects, and cleans up.
 *
 * Run from repo root:
 *   pnpm --filter @ch/api exec tsx scripts/test-classify-title.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Force rule-based mode BEFORE we import anything that might cache the env.
process.env.CLASSIFICATION_SKIP_LLM = '1';
process.env.TITLE_SKIP_LLM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });

const { query } = await import('@ch/db');
const { getQueue, QUEUE_NAMES } = await import('@ch/agents');
const { randomUUID } = await import('node:crypto');

const { classifyTitleOne, startClassifyTitleWorker } =
  await import('../src/workers/classify-title/index.js');
const { makeUniqueSlug } = await import('../src/workers/classify-title/slug.js');

const TEST_TAG = `__test_classify_title_${Date.now()}`;
let sourceId: string;
let rawItemId: string;
let itemId: string;

let pass = 0;
let fail = 0;
const errors: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    pass++;
  } else {
    console.log(`  ✗ ${msg}`);
    errors.push(msg);
    fail++;
  }
}

async function setup() {
  console.log('\n[setup] inserting disposable source + raw_item + item');
  sourceId = randomUUID();
  await query(
    `INSERT INTO sources (id, platform, external_id, name, url, status, config)
     VALUES ($1, 'html', $2, $2, 'https://example.test/feed', 'active', '{}')`,
    [sourceId, TEST_TAG],
  );

  rawItemId = randomUUID();
  await query(
    `INSERT INTO raw_items (id, source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, $2, 'https://example.test/article-1', $3, $4, NOW(),
             $5, JSON_ARRAY())`,
    [
      rawItemId,
      sourceId,
      `${TEST_TAG}_dedupe`,
      `${TEST_TAG}_hash`,
      JSON.stringify({ title: 'OpenAI 发布全新 GPT-5 大语言模型，性能远超 Claude' }),
    ],
  );

  const content = '人工智能领域迎来里程碑：OpenAI 今日正式发布 GPT-5，' +
    '该模型在多项基准测试上超越了上一代产品。神经网络规模翻倍，机器学习社区反响热烈。' +
    'OpenAI 表示开发者可通过 API 立即接入。Anthropic 的 Claude 此前是该领域强有力的竞争对手。' +
    '业界普遍认为大模型竞争已进入新阶段。'.repeat(2);

  itemId = randomUUID();
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, content, content_html)
     VALUES ($1, $2, $3, 'INGESTED', $4, $5, $6)`,
    [
      itemId,
      rawItemId,
      sourceId,
      'OpenAI 发布全新 GPT-5 大语言模型，性能远超 Claude',
      content,
      `<p>${content}</p>`,
    ],
  );
  console.log(`  source=${sourceId.slice(0, 8)}…  raw=${rawItemId.slice(0, 8)}…  item=${itemId.slice(0, 8)}…`);
}

async function cleanup() {
  console.log('\n[cleanup] dropping test fixtures');
  await query(`DELETE FROM agent_runs WHERE item_id = $1`, [itemId]).catch(() => {});
  await query(`DELETE FROM items WHERE id = $1`, [itemId]).catch(() => {});
  await query(`DELETE FROM raw_items WHERE id = $1`, [rawItemId]).catch(() => {});
  await query(`DELETE FROM sources WHERE id = $1`, [sourceId]).catch(() => {});
  // Also drain any cover-queue jobs that point at this itemId
  const q = getQueue(QUEUE_NAMES.cover);
  const jobs = await q.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 100);
  for (const j of jobs) {
    if ((j.data as any)?.itemId === itemId) await j.remove().catch(() => {});
  }
}

// Use the real classifyTitleOne so we exercise the production minLen guard,
// status branching, and DB updates.
type AgentOut = Awaited<ReturnType<typeof classifyTitleOne>>;

async function testHappyPath() {
  console.log('\n[test 1] INGESTED → TITLED, rule-based');
  const out = await classifyTitleOne(itemId) as AgentOut;
  const [after] = await query<{
    status: string; category: string | null; tags: string[]; keywords: string[];
    title: string | null; summary: string | null; slug: string | null; title_version: number;
  }>(
    `SELECT status, category, tags, keywords, title, summary, slug, title_version
     FROM items WHERE id=$1`,
    [itemId],
  );

  assert(after.status === 'TITLED', `status flipped to TITLED (got ${after.status})`);
  assert(!!after.category, `category populated (${after.category})`);
  assert(after.tags.length > 0, `tags populated (${after.tags.length})`);
  assert(after.keywords.length > 0, `keywords populated (${after.keywords.length})`);
  assert(!!after.title, `title populated (${after.title})`);
  assert(!!after.summary && after.summary.length > 0, `summary populated (${after.summary?.length} chars)`);
  assert(!!after.slug && /^[a-z0-9-]+$/.test(after.slug), `slug ascii-safe (${after.slug})`);
  assert(after.title_version === 1, `title_version incremented to 1 (got ${after.title_version})`);
  // Rule-based must classify "AI" / 大模型 / OpenAI / Claude / 神经网络 / 机器学习
  assert((out as any).category === 'AI', `rule classifier picked AI (got ${(out as any).category})`);
  assert(typeof (out as any).model === 'string' && (out as any).model.includes('rule'),
    `model field surfaces rule-based marker (got ${(out as any).model})`);
}

async function testCoverHandoff() {
  console.log('\n[test 2] cover queue receives the handoff');
  const q = getQueue(QUEUE_NAMES.cover);
  const job = await q.getJob(`cover__${itemId}`);
  assert(!!job, `cover job exists with id cover__${itemId.slice(0, 8)}…`);
  assert((job?.data as any)?.itemId === itemId, `cover job carries the right itemId`);
}

async function testResumePath() {
  console.log('\n[test 3] resume from CLASSIFIED keeps category, only re-runs title');
  // Roll item back to CLASSIFIED with a *fixed* category to verify it survives
  await query(
    `UPDATE items SET status='CLASSIFIED', title=NULL, summary=NULL, slug=NULL,
                      category='硬件', tags=$2, keywords=$3
     WHERE id=$1`,
    [itemId, ['芯片', 'GPU'], ['硬件']],
  );
  const out = await classifyTitleOne(itemId) as AgentOut;
  const [after] = await query<{ status: string; category: string; tags: string[]; title: string }>(
    `SELECT status, category, tags, title FROM items WHERE id=$1`,
    [itemId],
  );
  assert(after.status === 'TITLED', `status flipped to TITLED again`);
  assert(after.category === '硬件', `category preserved (got ${after.category})`);
  assert(after.tags.includes('芯片'), `tags preserved (${after.tags.join(',')})`);
  assert((out as any).category === '硬件', `worker reused classification from DB`);
  assert(!!after.title, `title regenerated`);
}

async function testTooShortContent() {
  console.log('\n[test 4] item with too-short content throws');
  // Insert second item with content under the rule-based 10-char floor
  const shortRawId = randomUUID();
  await query(
    `INSERT INTO raw_items (id, source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, $2, 'https://example.test/short', $3, $4, NOW(), '{}', JSON_ARRAY())`,
    [shortRawId, sourceId, `${TEST_TAG}_short`, `${TEST_TAG}_short_hash`],
  );
  const shortItemId = randomUUID();
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, content)
     VALUES ($1, $2, $3, 'INGESTED', '短', 'abc')`,
    [shortItemId, shortRawId, sourceId],
  );

  let threw = false;
  let errMsg = '';
  try {
    await classifyTitleOne(shortItemId);
  } catch (e: any) {
    errMsg = e?.message ?? String(e);
    threw = /content too short/.test(errMsg);
  }
  assert(threw, `too-short content rejected with content too short error (got: "${errMsg}")`);
  await query(`DELETE FROM items WHERE id=$1`, [shortItemId]);
  await query(`DELETE FROM raw_items WHERE id=$1`, [shortRawId]);
}

async function testWrongStatusSkip() {
  console.log('\n[test 5] item not in INGESTED/CLASSIFIED/TITLED is a no-op');
  await query(`UPDATE items SET status='COVERED' WHERE id=$1`, [itemId]);
  const out = await classifyTitleOne(itemId) as { skipped?: boolean; status?: string };
  assert(out.skipped === true, `worker reported skipped=true (got ${JSON.stringify(out)})`);
  assert(out.status === 'COVERED', `skip return surfaces current status`);
  // Restore
  await query(`UPDATE items SET status='TITLED' WHERE id=$1`, [itemId]);
}

async function testTitledRerun() {
  console.log('\n[test 6.5] TITLED item re-runs title only, keeps category, bumps title_version');
  const [before] = await query<{ category: string; title: string; title_version: number }>(
    `SELECT category, title, title_version FROM items WHERE id=$1`,
    [itemId],
  );
  const out = await classifyTitleOne(itemId) as AgentOut;
  const [after] = await query<{ category: string; title: string; title_version: number; status: string }>(
    `SELECT category, title, title_version, status FROM items WHERE id=$1`,
    [itemId],
  );
  assert(after.status === 'TITLED', `still TITLED after rerun (got ${after.status})`);
  assert(after.category === before.category, `rerun preserved category (${after.category})`);
  assert(after.title_version === before.title_version + 1,
    `title_version incremented ${before.title_version}→${after.title_version}`);
  assert((out as any).category === before.category, `worker reused classification from DB on rerun`);
}

async function testSlugCollisionResistant() {
  console.log('\n[test 6] slug is deterministic for the same itemId');
  const a = await makeUniqueSlug('OpenAI 发布全新 GPT-5 大语言模型', itemId);
  const b = await makeUniqueSlug('OpenAI 发布全新 GPT-5 大语言模型', itemId);
  assert(a === b, `same itemId+title → same slug (${a})`);
  assert(/^[a-z0-9-]+-[a-f0-9]{6}$/.test(a), `slug shape: stem-<6hex>`);
}

async function testRealWorkerThroughBullMQ() {
  console.log('\n[test 7] real worker via BullMQ end-to-end');
  // Reset to INGESTED
  await query(
    `UPDATE items SET status='INGESTED', category=NULL, tags=JSON_ARRAY(),
       keywords=JSON_ARRAY(), title='OpenAI 发布全新 GPT-5 大语言模型，性能远超 Claude',
       summary=NULL, slug=NULL, title_version=0
     WHERE id=$1`,
    [itemId],
  );
  // Drain any leftover cover handoffs from earlier tests
  const cover = getQueue(QUEUE_NAMES.cover);
  for (const j of await cover.getJobs(['waiting', 'active', 'completed'], 0, 100)) {
    if ((j.data as any)?.itemId === itemId) await j.remove().catch(() => {});
  }

  const worker = startClassifyTitleWorker();

  // Enqueue and wait for it to be picked up
  const q = getQueue(QUEUE_NAMES.classifyTitle);
  const job = await q.add(
    'classify-title',
    { itemId },
    { jobId: `classify-title__${itemId}__test` },
  );
  console.log(`  enqueued job ${job.id}`);

  // Wait up to 30s for the job to complete
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      console.log(`  job state=${state} after ${Date.now() - started}ms`);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const finalState = await job.getState();
  assert(finalState === 'completed', `BullMQ job completed (got ${finalState})`);

  const [after] = await query<{ status: string; title: string | null; slug: string | null }>(
    `SELECT status, title, slug FROM items WHERE id=$1`,
    [itemId],
  );
  // Accept TITLED or any downstream status: if the API process's cover worker
  // is also running, it can race us and advance the item before we assert.
  // What we really care about is that the classify-title step ran, which is
  // proven by title+slug being populated.
  const downstream = ['TITLED', 'COVERED', 'COMPLIANCE_PASS', 'COMPLIANCE_REVIEW', 'COMPLIANCE_FAIL', 'PUBLISHED', 'DISTRIBUTED'];
  assert(downstream.includes(after.status), `BullMQ run flipped status forward (got ${after.status})`);
  assert(!!after.title && !!after.slug, `BullMQ run populated title+slug`);

  const [run] = await query<{ status: string; agent: string; cost_usd: string | null }>(
    `SELECT status, agent, CAST(cost_usd AS CHAR) AS cost_usd FROM agent_runs
     WHERE item_id=$1 AND agent='classify-title'
     ORDER BY started_at DESC LIMIT 1`,
    [itemId],
  );
  assert(run?.agent === 'classify-title', `agent_runs row uses classify-title (got ${run?.agent})`);
  assert(run?.status === 'success', `agent_runs row succeeded (got ${run?.status})`);

  // Cover queue should now have a new handoff job from the BullMQ run
  const cover2 = getQueue(QUEUE_NAMES.cover);
  const coverJob = await cover2.getJob(`cover__${itemId}`);
  assert(!!coverJob, `BullMQ run produced a cover handoff job`);

  await worker.close();
}

async function main() {
  await setup();
  try {
    await testHappyPath();
    await testCoverHandoff();
    await testResumePath();
    await testTooShortContent();
    await testWrongStatusSkip();
    await testTitledRerun();
    await testSlugCollisionResistant();
    await testRealWorkerThroughBullMQ();
  } finally {
    await cleanup();
  }
  console.log(`\n=== summary: ${pass} passed, ${fail} failed ===`);
  if (fail) {
    console.log('failures:');
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('test crashed:', e);
    process.exit(2);
  })
  .finally(async () => {
    // Force-exit so BullMQ/redis connections don't keep us alive
    setTimeout(() => process.exit(0), 200).unref();
  });
