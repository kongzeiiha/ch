/**
 * One-shot data cleaner for items.tags and items.keywords.
 *
 * Strips three classes of garbage that snuck in before the categorize.ts fix:
 *   1. empty / whitespace strings (broke `next build` on /tag/[slug])
 *   2. URL debris from tweet-style links: "https", "co", "t", "9q", ...
 *   3. percent-encoded fragments like "%E4%BA%92"
 *
 * Idempotent — safe to run multiple times.
 *
 *   pnpm --filter @ch/api exec tsx scripts/clean-tags.ts
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

const TOKEN_DENYLIST = new Set([
  'http', 'https', 'www',
  't', 'co', 'cn', 'com', 'org', 'net', 'io', 'app', 'html', 'htm',
  'amp', 'utm', 'src', 'ref',
]);

function isClean(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length < 2 || t.length > 32) return false;
  if (TOKEN_DENYLIST.has(t.toLowerCase())) return false;
  if (t.includes('%')) return false;
  if (/^[a-z0-9]{1,3}$/i.test(t)) return false;
  return true;
}

interface Row {
  id: string;
  tags: unknown;
  keywords: unknown;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()))).filter(isClean);
}

async function main() {
  const rows = await query<Row>(`SELECT id, tags, keywords FROM items`);
  console.log(`scanned ${rows.length} items`);

  let changed = 0;
  let tagsRemoved = 0;
  let keywordsRemoved = 0;

  for (const row of rows) {
    const oldTags = asArray(row.tags);
    const oldKw   = asArray(row.keywords);
    const newTags = dedupe(oldTags);
    const newKw   = dedupe(oldKw);

    if (newTags.length !== oldTags.length || newKw.length !== oldKw.length
        || newTags.some((t, i) => t !== oldTags[i])
        || newKw.some((t, i) => t !== oldKw[i])) {
      tagsRemoved += oldTags.length - newTags.length;
      keywordsRemoved += oldKw.length - newKw.length;
      // Use CAST(? AS JSON) explicitly — items.tags / .keywords are
      // `json NOT NULL`, and mysql2 binds JS arrays as their stringified form.
      await execute(
        `UPDATE items SET tags = CAST($2 AS JSON), keywords = CAST($3 AS JSON) WHERE id = $1`,
        [row.id, JSON.stringify(newTags), JSON.stringify(newKw)],
      );
      changed++;
    }
  }

  console.log(`updated ${changed} items · -${tagsRemoved} tags · -${keywordsRemoved} keywords`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
