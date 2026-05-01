/**
 * Smoke test for the 7 agents not already covered by test-classify-title.ts:
 *   ingestion (helpers + persist), cover, compliance, publishing,
 *   source-scoring, distribution, analytics.
 *
 * Calls each agent's *One() function directly (no BullMQ) so the running
 * API workers can't race us. All LLM-using agents run with their SKIP_LLM
 * flag so no Groq credits are spent.
 *
 * Run:
 *   pnpm --filter @ch/api exec tsx scripts/test-all-agents.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Force rule-based mode BEFORE any worker import binds the env at module load.
process.env.CLASSIFICATION_SKIP_LLM = '1';
process.env.TITLE_SKIP_LLM = '1';
process.env.COVER_SKIP_LLM = '1';
process.env.COMPLIANCE_SKIP_LLM = '1';
process.env.DISTRIBUTION_SKIP_LLM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env') });
// Reapply skip flags in case .env tried to override.
process.env.CLASSIFICATION_SKIP_LLM = '1';
process.env.TITLE_SKIP_LLM = '1';
process.env.COVER_SKIP_LLM = '1';
process.env.COMPLIANCE_SKIP_LLM = '1';
process.env.DISTRIBUTION_SKIP_LLM = '1';

const { query } = await import('@ch/db');
const { getQueue, QUEUE_NAMES } = await import('@ch/agents');

const ingestion = await import('../src/workers/ingestion/index.js');
const dedupe = await import('../src/workers/ingestion/dedupe.js');
const simhashMod = await import('../src/workers/ingestion/simhash.js');
const cleanMod = await import('../src/workers/ingestion/clean.js');
const persistMod = await import('../src/workers/ingestion/persist.js');
const cover = await import('../src/workers/cover/index.js');
const compliance = await import('../src/workers/compliance/index.js');
const blacklistMod = await import('../src/workers/compliance/blacklist.js');
const decideMod = await import('../src/workers/compliance/decide.js');
const publishing = await import('../src/workers/publishing/index.js');
const distribution = await import('../src/workers/distribution/index.js');
const sourceScoring = await import('../src/workers/source-scoring/scorer.js');
const analyticsGa4 = await import('../src/workers/analytics/ga4.js');
const analyticsReport = await import('../src/workers/analytics/report.js');

const TAG = `__test_all_agents_${Date.now()}`;
let pass = 0, fail = 0;
const failures: string[] = [];

function ok(cond: unknown, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else      { console.log(`  ✗ ${msg}`); failures.push(msg); fail++; }
}

interface Fixture {
  sourceId: string;
  rawItemId: string;
  itemId: string;
}

async function makeFixture(opts: { content?: string; status?: string; title?: string; category?: string } = {}): Promise<Fixture> {
  const content =
    opts.content ??
    ('人工智能领域迎来里程碑：OpenAI 今日正式发布 GPT-5，' +
      '该模型在多项基准测试上超越了上一代产品。神经网络规模翻倍，机器学习社区反响热烈。' +
      'Anthropic 的 Claude 此前是该领域强有力的竞争对手。'.repeat(2));
  const title = opts.title ?? 'OpenAI 发布全新 GPT-5 大语言模型';

  const [src] = await query<{ id: string }>(
    `INSERT INTO sources (platform, external_id, name, url, status, config)
     VALUES ('html', $1, $1, 'https://example.test/feed', 'active', '{}'::jsonb)
     RETURNING id`,
    [`${TAG}_${Math.random().toString(36).slice(2, 8)}`],
  );
  const [raw] = await query<{ id: string }>(
    `INSERT INTO raw_items (source_id, url, dedupe_key, content_hash, fetched_at, raw_payload, media_urls)
     VALUES ($1, 'https://example.test/a', $2, $3, NOW(), '{}'::jsonb, ARRAY[]::text[])
     RETURNING id`,
    [src.id, `${TAG}_${src.id}_dedupe`, `${TAG}_${src.id}_hash`],
  );
  const [it] = await query<{ id: string }>(
    `INSERT INTO items (raw_item_id, source_id, status, title, content, content_html, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [raw.id, src.id, opts.status ?? 'INGESTED', title, content, `<p>${content}</p>`, opts.category ?? null],
  );
  return { sourceId: src.id, rawItemId: raw.id, itemId: it.id };
}

async function dropFixture(f: Fixture) {
  await query(`DELETE FROM agent_runs WHERE item_id = $1`, [f.itemId]).catch(() => {});
  await query(`DELETE FROM distribution_tasks WHERE item_id = $1`, [f.itemId]).catch(() => {});
  await query(`DELETE FROM analytics_daily WHERE item_id = $1`, [f.itemId]).catch(() => {});
  await query(`DELETE FROM items WHERE id = $1`, [f.itemId]).catch(() => {});
  await query(`DELETE FROM raw_items WHERE id = $1`, [f.rawItemId]).catch(() => {});
  await query(`DELETE FROM sources WHERE id = $1`, [f.sourceId]).catch(() => {});
  // Drain any leftover handoff jobs that point at this item
  for (const qname of [QUEUE_NAMES.cover, QUEUE_NAMES.compliance, QUEUE_NAMES.publishing, QUEUE_NAMES.distribution]) {
    const q = getQueue(qname);
    const jobs = await q.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 50);
    for (const j of jobs) if ((j.data as any)?.itemId === f.itemId) await j.remove().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. Ingestion (helpers + persist + error path; no network adapter call)
// ─────────────────────────────────────────────────────────────────────
async function testIngestion() {
  console.log('\n[ingestion]');

  // 1a. clean() extracts text + media from HTML
  const html = '<html><body><article><h1>大模型评测</h1>' +
    '<p>'.padEnd(220, 'x') + '</p>' +
    '<p>更多内容</p><img src="/x.jpg"/></article></body></html>';
  const cleaned = cleanMod.clean(html, 'https://example.test/a');
  ok(!!cleaned, 'clean() returns a Cleaned struct for non-trivial HTML');
  ok(cleaned!.length >= 200, `clean() text length ≥ 200 (${cleaned!.length})`);

  // 1b. simhash + hamming distance behaves
  const fp1 = simhashMod.simhash('hello world this is a test');
  const fp2 = simhashMod.simhash('hello world this is a test');
  const fp3 = simhashMod.simhash('totally unrelated content about cooking');
  ok(simhashMod.hamming(fp1, fp2) === 0, 'simhash identical text → distance 0');
  ok(simhashMod.hamming(fp1, fp3) > 5, 'simhash unrelated text → distance > 5');

  // 1c. dedupe helpers + persist roundtrip
  const f = await makeFixture();
  const seen = await dedupe.urlAlreadySeen(f.sourceId, `${TAG}_${f.sourceId}_dedupe`);
  ok(seen === true, 'urlAlreadySeen() finds the inserted dedupe_key');
  const seenContent = await dedupe.contentAlreadySeenForSource(f.sourceId, `${TAG}_${f.sourceId}_hash`);
  ok(seenContent === true, 'contentAlreadySeenForSource() finds the inserted hash');

  // persistIngested writes raw_items + items + bumps last_fetch_at
  const newKey = `${TAG}_persist_${Math.random().toString(36).slice(2, 8)}`;
  const r = await persistMod.persistIngested({
    sourceId: f.sourceId,
    url: 'https://example.test/a2',
    fetchedAt: new Date(),
    rawPayload: { title: 'p2' },
    mediaUrls: [],
    contentHash: newKey + '_h',
    dedupeKey: newKey,
    simhash: 0n,
    title: 'p2',
    summary: 'sum',
    content: 'x'.repeat(220),
    contentHtml: '<p>x</p>',
  });
  ok(!!r.itemId && !!r.rawItemId, 'persistIngested() returns ids');
  const [persistedItem] = await query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [r.itemId]);
  ok(persistedItem?.status === 'INGESTED', `persisted item starts at INGESTED (got ${persistedItem?.status})`);

  // 1d. ingestSource() with non-existent source throws
  let caught = '';
  try {
    await ingestion.ingestSource('00000000-0000-0000-0000-000000000000');
  } catch (e: any) {
    caught = e?.message ?? String(e);
  }
  ok(/not found|inactive/.test(caught), `ingestSource(unknown) throws (got: "${caught}")`);

  // cleanup the extra raw+item from persist test
  await query(`DELETE FROM items WHERE id = $1`, [r.itemId]).catch(() => {});
  await query(`DELETE FROM raw_items WHERE id = $1`, [r.rawItemId]).catch(() => {});
  await dropFixture(f);
}

// ─────────────────────────────────────────────────────────────────────
// 2. Cover (with empty media → no upload but status still flips)
// ─────────────────────────────────────────────────────────────────────
async function testCover() {
  console.log('\n[cover]');

  // No-media path: coverOne should still flip status to COVERED, but with
  // null cover_url/cover_copy/model since there were no images to pick.
  const f = await makeFixture({ status: 'TITLED', title: 'cover test article' });
  const out = await cover.coverOne(f.itemId) as any;
  ok(!out?.skipped, 'coverOne() did not skip');
  ok(out?.cover_url === null, 'cover_url is null when media_urls is empty');
  ok(out?.cover_copy === null, 'cover_copy is null when there are no picks');
  ok(out?.model === null, 'model is null when there are no picks');
  ok(out?.gallery_count === 0, 'gallery_count is 0 when there are no picks');

  const [after] = await query<{ status: string; cover_url: string | null; cover_copy: string | null }>(
    `SELECT status, cover_url, cover_copy FROM items WHERE id = $1`,
    [f.itemId],
  );
  ok(after.status === 'COVERED', `status flipped to COVERED (got ${after.status})`);
  ok(after.cover_url === null && after.cover_copy === null, 'DB columns also null');

  // compliance handoff job should have been enqueued
  const job = await getQueue(QUEUE_NAMES.compliance).getJob(`compliance__${f.itemId}`);
  ok(!!job, 'cover → compliance handoff job present');

  // wrong-status item is a soft skip
  await query(`UPDATE items SET status='PUBLISHED' WHERE id=$1`, [f.itemId]);
  const skipOut = await cover.coverOne(f.itemId) as any;
  ok(skipOut?.skipped === true, `cover skips items already past COVERED (got ${JSON.stringify(skipOut)})`);

  await dropFixture(f);
}

// ─────────────────────────────────────────────────────────────────────
// 3. Compliance (clean → PASS, blacklist → FAIL)
// ─────────────────────────────────────────────────────────────────────
async function testCompliance() {
  console.log('\n[compliance]');

  // Clean content under SKIP_LLM should auto-PASS via synthesized zero-risk
  const f1 = await makeFixture({ status: 'COVERED', title: '清洁的标题' });
  const out1 = await compliance.complianceOne(f1.itemId) as any;
  ok(out1?.decision === 'COMPLIANCE_PASS', `clean text → PASS (got ${out1?.decision})`);
  const [after1] = await query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [f1.itemId]);
  ok(after1.status === 'COMPLIANCE_PASS', `db status updated to COMPLIANCE_PASS`);
  const pubJob = await getQueue(QUEUE_NAMES.publishing).getJob(`publish__${f1.itemId}`);
  ok(!!pubJob, 'compliance → publishing handoff job present on PASS');
  await dropFixture(f1);

  // Blacklist hit → FAIL, no publishing handoff
  const dirty = '版权所有,未经授权不得转载\n' + 'x'.repeat(400);
  const f2 = await makeFixture({ status: 'COVERED', title: 'dirty', content: dirty });
  const out2 = await compliance.complianceOne(f2.itemId) as any;
  ok(out2?.decision === 'COMPLIANCE_FAIL', `blacklist text → FAIL (got ${out2?.decision})`);
  ok(out2?.trigger === 'blacklist', `trigger == blacklist (got ${out2?.trigger})`);
  const noPub = await getQueue(QUEUE_NAMES.publishing).getJob(`publish__${f2.itemId}`);
  ok(!noPub, 'compliance → no publishing handoff on FAIL');
  await dropFixture(f2);

  // decide() unit cases
  const passDec = decideMod.decide([], { scores: { '政治敏感': 0, '色情低俗': 0, '暴力恐怖': 0, '版权争议': 0, '医疗夸大': 0, '金融诱导': 0 }, reasons: {} } as any);
  ok(passDec.status === 'COMPLIANCE_PASS' && passDec.trigger === 'pass', 'decide(): all-zero → PASS');
  const review = decideMod.decide([], { scores: { '政治敏感': 2, '色情低俗': 0, '暴力恐怖': 0, '版权争议': 0, '医疗夸大': 0, '金融诱导': 0 }, reasons: {} } as any);
  ok(review.status === 'COMPLIANCE_REVIEW', 'decide(): max=2 → REVIEW');
  const reject = decideMod.decide([], { scores: { '政治敏感': 3, '色情低俗': 0, '暴力恐怖': 0, '版权争议': 0, '医疗夸大': 0, '金融诱导': 0 }, reasons: {} } as any);
  ok(reject.status === 'COMPLIANCE_FAIL', 'decide(): max=3 → FAIL');
  const noLlm = decideMod.decide([], undefined);
  ok(noLlm.status === 'COMPLIANCE_REVIEW' && noLlm.trigger === 'llm_review', 'decide(): no risk score → REVIEW');

  // blacklist module sanity
  const hits = blacklistMod.runBlacklist('© 2024 BigCo all rights reserved');
  ok(hits.some((h) => h.category === 'copyright_watermark'), 'blacklist catches copyright watermark');
}

// ─────────────────────────────────────────────────────────────────────
// 4. Publishing (COMPLIANCE_PASS → PUBLISHED, slug+url populated)
// ─────────────────────────────────────────────────────────────────────
async function testPublishing() {
  console.log('\n[publishing]');

  const f = await makeFixture({ status: 'COMPLIANCE_PASS', title: 'pub 测试 文章', category: 'AI' });
  const out = await publishing.publishOne(f.itemId) as any;
  ok(typeof out?.slug === 'string' && out.slug.length > 0, `slug returned (${out?.slug})`);
  ok(out?.publishedUrl?.startsWith('/a/'), `publishedUrl shape /a/<slug> (${out?.publishedUrl})`);
  ok(typeof out?.fullUrl === 'string' && out.fullUrl.includes(out.slug), 'fullUrl contains slug');
  const [after] = await query<{ status: string; slug: string | null; published_url: string | null; published_at: string | null }>(
    `SELECT status, slug, published_url, published_at FROM items WHERE id = $1`,
    [f.itemId],
  );
  ok(after.status === 'PUBLISHED', `status flipped to PUBLISHED (got ${after.status})`);
  ok(!!after.slug && !!after.published_url, 'slug and published_url written to DB');
  ok(!!after.published_at, 'published_at populated');

  // No-title item must throw
  const f2 = await makeFixture({ status: 'COMPLIANCE_PASS', title: 'will-be-nulled' });
  await query(`UPDATE items SET title=NULL WHERE id=$1`, [f2.itemId]);
  let threw = false;
  try { await publishing.publishOne(f2.itemId); } catch (e: any) {
    threw = /no title/.test(e?.message ?? '');
  }
  ok(threw, 'publishOne throws when item has no title');

  // Strict mode: only COMPLIANCE_PASS / PUBLISHED accepted
  process.env.PUBLISH_STRICT = '1';
  const f3 = await makeFixture({ status: 'COVERED', title: 'strict test' });
  const strictOut = await publishing.publishOne(f3.itemId) as any;
  ok(strictOut?.skipped === true && /strict/.test(strictOut?.reason ?? ''), `strict mode rejects non-PASS (got ${JSON.stringify(strictOut)})`);
  process.env.PUBLISH_STRICT = '0';

  await dropFixture(f);
  await dropFixture(f2);
  await dropFixture(f3);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Source-scoring (pure SQL, no LLM)
// ─────────────────────────────────────────────────────────────────────
async function testSourceScoring() {
  console.log('\n[source-scoring]');

  const f = await makeFixture({ status: 'PUBLISHED' });
  // Give the source one PUBLISHED item so it has some signal
  const out = await sourceScoring.scoreAllSources();
  ok(typeof out.updated === 'number' && out.updated > 0, `scoreAllSources updated ${out.updated} sources`);
  ok(Array.isArray(out.samples), 'samples array returned');

  // Our test source should be in the result with a finite score
  const sample = out.samples.find((s) => s.id === f.sourceId);
  ok(!!sample, 'test source appears in samples');
  ok(typeof sample!.after === 'number' && sample!.after >= 0 && sample!.after <= 100, `score clamped 0-100 (got ${sample?.after})`);

  // Sanity: re-running is idempotent (no exceptions, same shape)
  const out2 = await sourceScoring.scoreAllSources();
  ok(out2.updated === out.updated, 'second run updates same number of sources');

  await dropFixture(f);
}

// ─────────────────────────────────────────────────────────────────────
// 6. Distribution (PUBLISHED → DISTRIBUTED, rule-based copy)
// ─────────────────────────────────────────────────────────────────────
async function testDistribution() {
  console.log('\n[distribution]');

  const f = await makeFixture({ status: 'PUBLISHED', title: 'dist 测试文章 标题' });
  // Give it a published_url + slug like a real PUBLISHED item
  await query(
    `UPDATE items SET slug = $2, published_url = $3, summary = '一段简短的摘要', tags = ARRAY['AI','测试']
     WHERE id = $1`,
    [f.itemId, `slug-${f.itemId.slice(0, 6)}`, `http://localhost:3000/a/slug-${f.itemId.slice(0, 6)}`],
  );

  const out = await distribution.distributeOne(f.itemId, 'twitter') as any;
  ok(typeof out?.copy === 'string' && out.copy.length > 0, `copy generated (${out?.copy?.slice(0, 60)}…)`);
  ok(out?.copy?.includes('http'), 'copy contains the link');
  ok(out?.model === 'rule:headline+tags', `model marker is rule:* under SKIP_LLM (got ${out?.model})`);
  ok(out?.copy?.length <= 280, `copy fits Twitter budget (${out?.copy?.length} chars)`);

  // distribution_tasks row inserted
  const [task] = await query<{ channel: string; status: string; copy: string }>(
    `SELECT channel, status, copy FROM distribution_tasks WHERE item_id = $1`,
    [f.itemId],
  );
  ok(task?.channel === 'twitter' && task?.status === 'pending', 'distribution_tasks row inserted as pending');

  const [after] = await query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [f.itemId]);
  ok(after.status === 'DISTRIBUTED', `item flipped to DISTRIBUTED (got ${after.status})`);

  // Re-distributing the same channel is a no-op
  const dup = await distribution.distributeOne(f.itemId, 'twitter') as any;
  ok(dup?.skipped === true, `re-distribute is a skip (got ${JSON.stringify(dup)})`);

  // Non-PUBLISHED status is a skip
  const f2 = await makeFixture({ status: 'COVERED', title: 'still in pipeline' });
  const sk = await distribution.distributeOne(f2.itemId, 'twitter') as any;
  ok(sk?.skipped === true, `unpublished item is a skip (got ${JSON.stringify(sk)})`);

  await dropFixture(f);
  await dropFixture(f2);
}

// ─────────────────────────────────────────────────────────────────────
// 7. Analytics (pull is no-op without GA4 creds, report queries DB)
// ─────────────────────────────────────────────────────────────────────
async function testAnalytics() {
  console.log('\n[analytics]');

  const out = await analyticsGa4.pullAnalyticsYesterday();
  ok(typeof out.date === 'string' && /\d{4}-\d{2}-\d{2}/.test(out.date), `pull returns ISO date (${out.date})`);
  ok(typeof out.upserted === 'number' && typeof out.skipped === 'number',
    `pull returns upserted/skipped counts (${out.upserted}/${out.skipped})`);

  // Insert a fake analytics_daily row + matching item, then verify the report includes it
  const f = await makeFixture({ status: 'PUBLISHED', title: 'report row title' });
  const slug = `analytics-${f.itemId.slice(0, 6)}`;
  await query(`UPDATE items SET slug = $2 WHERE id = $1`, [f.itemId, slug]);
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO analytics_daily (item_id, date, channel, pv, uv, avg_duration, revenue)
     VALUES ($1, $2, 'site', 1234, 567, 90, 12.34)
     ON CONFLICT (item_id, date, channel) DO UPDATE SET pv = EXCLUDED.pv`,
    [f.itemId, today],
  );

  const md = await analyticsReport.generateWeeklyReport();
  ok(typeof md === 'string' && md.startsWith('# 周报'), 'report starts with markdown title');
  ok(md.includes('## 汇总') && md.includes('## Top 10 文章'), 'report contains required sections');
  ok(md.includes('1,234') || md.includes('1234'), 'report includes our injected PV value');

  await dropFixture(f);
}

async function main() {
  console.log('========================================');
  console.log(' running all-agents smoke test');
  console.log('========================================');

  await testIngestion();
  await testCover();
  await testCompliance();
  await testPublishing();
  await testSourceScoring();
  await testDistribution();
  await testAnalytics();

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
  .catch((e) => {
    console.error('test crashed:', e);
    process.exit(2);
  })
  .finally(() => {
    setTimeout(() => process.exit(fail ? 1 : 0), 200).unref();
  });
