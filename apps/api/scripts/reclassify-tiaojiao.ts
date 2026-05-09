/**
 * One-shot re-classify for items mis-categorized as 调教.
 *
 * Background: the 调教 keyword regex had an empty alternation (`露点||走光`)
 * that matched the empty string in every text, giving 调教 a permanent +1
 * score and silently capturing every non-CJK article. After the regex fix,
 * existing rows still hold the wrong category until they're re-run.
 *
 * Strategy: bypass BullMQ entirely (the queues' jobId dedup blocks plain
 * re-enqueues from working) and invoke each worker's *One() function in
 * sequence on each affected item. Pipeline order:
 *
 *   reset DB → classifyTitleOne → coverOne → complianceOne → publishOne
 *
 * Items that re-classify back into 调教 (genuinely NSFW) stay there.
 *
 *   pnpm --filter @ch/api exec tsx scripts/reclassify-tiaojiao.ts
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const { query, ITEM_STATUS: IS } = await import('@ch/db');
const { classifyTitleOne } = await import('../src/workers/classify-title/index.js');
const { coverOne }         = await import('../src/workers/cover/index.js');
const { complianceOne }    = await import('../src/workers/compliance/index.js');
const { publishOne }       = await import('../src/workers/publishing/index.js');

async function reset(itemId: string) {
  await query(
    `UPDATE items SET
       status='${IS.INGESTED}',
       category=NULL,
       tags=JSON_ARRAY(),
       keywords=JSON_ARRAY(),
       title=NULL, summary=NULL, slug=NULL,
       cover_url=NULL, cover_sizes=NULL, cover_copy=NULL,
       compliance_status=NULL, risk_tags=JSON_ARRAY(), compliance_reasons=NULL,
       published_url=NULL, published_at=NULL
     WHERE id=$1`,
    [itemId],
  );
  await query(
    `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
     VALUES ('human:reclassify', $1, 'success', $2, NOW())`,
    [itemId, JSON.stringify({ from: '调教' })],
  );
}

async function runOne(id: string) {
  await reset(id);
  await classifyTitleOne(id);
  await coverOne(id);
  await complianceOne(id);
  // Publishing only proceeds when compliance passed.
  const [row] = await query<{ status: string }>(
    `SELECT status FROM items WHERE id=$1`, [id],
  );
  if (row?.status === IS.COMPLIANCE_PASS) await publishOne(id);
  const [final] = await query<{ status: string; category: string | null }>(
    `SELECT status, category FROM items WHERE id=$1`, [id],
  );
  return final;
}

async function main() {
  const targets = await query<{ id: string }>(
    `SELECT id FROM items WHERE category = '调教'`,
  );
  console.log(`re-classifying ${targets.length} items currently in 调教`);

  const moved: Record<string, number> = {};
  let failed = 0;

  for (const { id } of targets) {
    try {
      const after = await runOne(id);
      const cat = after?.category ?? '(null)';
      moved[cat] = (moved[cat] ?? 0) + 1;
      process.stdout.write(`  ${id.slice(0,8)} → ${after?.status} · ${cat}\n`);
    } catch (e: any) {
      failed++;
      process.stdout.write(`  ${id.slice(0,8)} FAILED: ${e?.message ?? e}\n`);
    }
  }

  console.log('\n=== Re-classify result ===');
  for (const [cat, n] of Object.entries(moved).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${cat.padEnd(14)} ${n}`);
  }
  if (failed) console.log(`  failed         ${failed}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
