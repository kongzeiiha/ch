/**
 * One-shot backfill: re-clean every items.title / items.summary / items.tags /
 * items.keywords through @ch/text-clean. Idempotent — safe to re-run.
 *
 *   pnpm --filter @ch/api exec tsx scripts/backfill-clean-titles.ts            # dry-run
 *   pnpm --filter @ch/api exec tsx scripts/backfill-clean-titles.ts --commit   # write
 *
 * What this fixes:
 *   - Pre-existing rows hold raw X-tweet text with emoji / hashtag chains /
 *     `关键词《X》` LLM tails. After this script + the classify-title write-
 *     time sanitizer landing, the DB never holds dirty title/summary again.
 *
 * Why a separate script (vs running the classify-title worker on each item):
 *   - We don't want to call the LLM again ($) — the existing classification +
 *     summary text is mostly correct, just needs scrubbing.
 *   - We don't want to bump title_version on a pure-cosmetic clean.
 *
 * Safety:
 *   - Default mode is dry-run; prints a diff and exits 0.
 *   - --commit mode UPDATES title / summary / tags / keywords (NOT slug,
 *     since changing slug would break inbound links — slugs are stable).
 *   - Skips rows whose cleaned values are identical to current (no-op write
 *     avoided so updated_at stays accurate for real edits).
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

const { query, execute } = await import('@ch/db');
const { displayTitle, cleanTagList } = await import('@ch/text-clean');

const COMMIT = process.argv.includes('--commit');

interface Row {
  id: string;
  title: string | null;
  summary: string | null;
  tags: unknown;
  keywords: unknown;
}

// mysql2 returns JSON columns parsed. Defensive re-parse just in case.
function parseJsonArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; }
  }
  return [];
}

function arrEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  console.log(`mode: ${COMMIT ? 'COMMIT (writes)' : 'DRY-RUN (no writes; pass --commit to apply)'}`);

  const rows = await query<Row>(
    `SELECT id, title, summary, tags, keywords FROM items`,
  );
  console.log(`scanning ${rows.length} items …\n`);

  let titleCh = 0, summaryCh = 0, tagsCh = 0, keywordsCh = 0, rowsTouched = 0;
  const samples: Array<{ id: string; before: any; after: any }> = [];

  for (const r of rows) {
    const before = {
      title: r.title ?? '',
      summary: r.summary ?? '',
      tags: parseJsonArr(r.tags) as string[],
      keywords: parseJsonArr(r.keywords) as string[],
    };
    const after = {
      // displayTitle does the strict pass (emoji / hashtag chain / arrow /
      // LLM tail / repeat-punct / 80-char cap). For backfill we keep the
      // 80-char cap so the H1 doesn't blow up; new writes do the same.
      // No `|| before.title` fallback — for URL-only rows like
      // "https://t.co/abc" the cleanup produces empty, and we WANT to
      // store empty so the frontend H1 falls through to its
      // "${category} · 无标题内容" placeholder instead of rendering a
      // raw URL. Worker has its own fallback (keeps the rawBest LLM
      // candidate) for fresh writes.
      title: displayTitle(before.title, 80),
      // Summary also goes through the strict displayTitle pipeline so we
      // catch hashtag chains / emoji / arrow deco that the lighter
      // stripTitleArtifacts misses. 300-char cap matches the worker's
      // write-time cap and leaves room for the full <meta description>.
      summary: displayTitle(before.summary, 300),
      tags: cleanTagList(before.tags),
      keywords: cleanTagList(before.keywords),
    };

    const titleDiff = before.title !== after.title;
    const summaryDiff = before.summary !== after.summary;
    const tagsDiff = !arrEq(before.tags, after.tags);
    const keywordsDiff = !arrEq(before.keywords, after.keywords);

    if (!titleDiff && !summaryDiff && !tagsDiff && !keywordsDiff) continue;
    rowsTouched++;
    if (titleDiff) titleCh++;
    if (summaryDiff) summaryCh++;
    if (tagsDiff) tagsCh++;
    if (keywordsDiff) keywordsCh++;

    if (samples.length < 5) {
      samples.push({ id: r.id, before, after });
    }

    if (COMMIT) {
      await execute(
        `UPDATE items
           SET title    = $2,
               summary  = $3,
               tags     = $4,
               keywords = $5
         WHERE id = $1`,
        [
          r.id,
          after.title,
          after.summary,
          JSON.stringify(after.tags),
          JSON.stringify(after.keywords),
        ],
      );
    }
  }

  console.log(`\nresult:`);
  console.log(`  rows touched : ${rowsTouched} / ${rows.length}`);
  console.log(`  title diff   : ${titleCh}`);
  console.log(`  summary diff : ${summaryCh}`);
  console.log(`  tags diff    : ${tagsCh}`);
  console.log(`  keywords diff: ${keywordsCh}`);
  console.log(`\nfirst ${samples.length} sample(s):`);
  for (const s of samples) {
    console.log(`\n  id ${s.id}`);
    if (s.before.title !== s.after.title) {
      console.log(`    title    : ${JSON.stringify(s.before.title).slice(0, 120)}`);
      console.log(`           →   ${JSON.stringify(s.after.title).slice(0, 120)}`);
    }
    if (s.before.summary !== s.after.summary) {
      console.log(`    summary  : ${JSON.stringify(s.before.summary).slice(0, 120)}`);
      console.log(`           →   ${JSON.stringify(s.after.summary).slice(0, 120)}`);
    }
    if (!arrEq(s.before.tags, s.after.tags)) {
      console.log(`    tags     : ${JSON.stringify(s.before.tags).slice(0, 120)}`);
      console.log(`           →   ${JSON.stringify(s.after.tags).slice(0, 120)}`);
    }
    if (!arrEq(s.before.keywords, s.after.keywords)) {
      console.log(`    keywords : ${JSON.stringify(s.before.keywords).slice(0, 120)}`);
      console.log(`           →   ${JSON.stringify(s.after.keywords).slice(0, 120)}`);
    }
  }

  if (!COMMIT) {
    console.log(`\n(no writes) — re-run with --commit to apply.`);
  } else {
    console.log(`\ndone.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
