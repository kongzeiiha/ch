/**
 * One-shot re-classify for items currently bucketed as '其他'.
 *
 * After expanding the taxonomy (番号 / 美乳 / 美腿 / 美臀 / 颜射 / 潮吹 /
 * 露出 / 制服 / 多人 / 黑丝) and fixing the broken `自拍` regex, existing
 * items still hold the old category until they're re-run through
 * classifyByRules.
 *
 * 跑法:
 *   pnpm --filter @ch/api exec tsx scripts/reclassify-other.ts
 *   pnpm --filter @ch/api exec tsx scripts/reclassify-other.ts --dry  # 只看会改成什么不写库
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

const dry = process.argv.includes('--dry');

const { query, execute } = await import('@ch/db');
const { classifyByRules } = await import('../src/workers/classify-title/categorize.js');

interface Row { id: string; slug: string | null; title: string | null; content: string | null; category: string | null }

const rows = await query<Row>(
  `SELECT id, slug, title, content, category
   FROM items
   WHERE category = '其他' AND status IN ('PUBLISHED','DISTRIBUTED')
   ORDER BY published_at DESC`,
);

console.log(`[reclassify-other] ${rows.length} items currently in 其他`);
if (dry) console.log('[reclassify-other] --dry: not writing to DB');

const before = new Map<string, number>();
const after  = new Map<string, number>();
let changed = 0;

for (const r of rows) {
  const oldCat = r.category ?? '其他';
  before.set(oldCat, (before.get(oldCat) ?? 0) + 1);

  const c = classifyByRules({ title: r.title, content: r.content ?? '' });
  after.set(c.category, (after.get(c.category) ?? 0) + 1);

  if (c.category !== oldCat) {
    changed++;
    if (changed <= 12) {
      console.log(`  ${oldCat} → ${c.category}  : ${(r.title ?? '').slice(0, 50)}`);
    }
    if (!dry) {
      // Only update category — leave tags/keywords alone unless we want to
      // pay the LLM cost (which the classify-title agent normally handles).
      // The rule-based tags are noisier than the LLM ones; safer to just fix
      // the category and let downstream surfaces (filter bar, sort) benefit.
      await execute(
        `UPDATE items SET category = $1 WHERE id = $2`,
        [c.category, r.id],
      );
    }
  }
}

console.log(`\n[reclassify-other] ${changed} items would move out of 其他`);
console.log('\nbucket distribution AFTER:');
for (const [cat, n] of [...after.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(8)} ${n}`);
}
process.exit(0);
