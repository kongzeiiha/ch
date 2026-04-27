// Crawl http://localhost:3000 and save every public page as standalone
// offline HTML. Images get inlined as base64 data URIs so the saved bundle
// works without the dev server, MinIO, or the API running.
//
// Output:  promote/site/index.html
//          promote/site/category/<slug>.html
//          promote/site/a/<slug>.html
//
// Internal links are rewritten to point at the local files so navigation
// works inside the bundle.

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const BASE = process.env.SNAP_BASE ?? 'http://localhost:3000';
const ORIGIN = new URL(BASE).origin;
const OUT_DIR = process.env.SNAP_OUT ?? resolve(process.cwd(), 'promote/site');
const WAIT_MS = Number(process.env.SNAP_WAIT_MS ?? 600);
const MAX_PAGES = Number(process.env.SNAP_MAX ?? 500);

const visited = new Set();
const queue = ['/'];

// Seed every published article + category page from the DB so we don't
// rely on home-page pagination links to find them.
async function seedFromDb() {
  const { execSync } = await import('node:child_process');
  const sql = `
    SELECT '/a/' || slug FROM items WHERE status='PUBLISHED' AND slug IS NOT NULL
    UNION
    SELECT DISTINCT '/category/' || category FROM items WHERE status='PUBLISHED' AND category IS NOT NULL
  `.replace(/\s+/g, ' ');
  try {
    const out = execSync(
      `docker exec ch-postgres-1 psql -U ch -d ch -tAc "${sql}"`,
      { encoding: 'utf8' },
    );
    const seeds = out.split('\n').map(s => s.trim()).filter(Boolean);
    console.log(`→ seeded ${seeds.length} URLs from db`);
    queue.push(...seeds);
  } catch (e) {
    console.warn(`could not seed from DB (${e.message}) — falling back to crawl-only`);
  }
}
await seedFromDb();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

function pathToFile(p) {
  if (p === '/' || p === '') return resolve(OUT_DIR, 'index.html');
  if (p.endsWith('/')) p = p.slice(0, -1);
  return resolve(OUT_DIR, p.replace(/^\//, '') + '.html');
}

function rewriteHref(href) {
  // /  → index.html
  // /a/foo → a/foo.html
  // /category/bar → category/bar.html
  if (href === '/' || href === '') return 'index.html';
  if (href.endsWith('/')) href = href.slice(0, -1);
  return href.replace(/^\//, '') + '.html';
}

function depthPrefix(p) {
  if (p === '/' || p === '') return '';
  const segs = p.replace(/^\//, '').split('/').filter(Boolean);
  return '../'.repeat(segs.length);
}

async function inlineImages(html) {
  const urls = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const unique = [...new Set(urls)];
  const subs = new Map();
  for (const u of unique) {
    if (u.startsWith('data:')) continue;
    try {
      const decoded = u.replace(/&amp;/g, '&');
      const abs = decoded.startsWith('http') ? decoded : new URL(decoded, ORIGIN).toString();
      const r = await page.request.get(abs, { timeout: 8000 });
      if (!r.ok()) { subs.set(u, null); continue; }
      const buf = await r.body();
      const ct = r.headers()['content-type']?.split(';')[0] || 'image/jpeg';
      subs.set(u, `data:${ct};base64,${buf.toString('base64')}`);
    } catch {
      subs.set(u, null);
    }
  }
  let out = html;
  for (const [u, data] of subs) {
    if (!data) continue;
    out = out.split(`src="${u}"`).join(`src="${data}"`);
  }
  return out;
}

function stripDynamic(html) {
  return html
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
}

function extractInternalHrefs(html) {
  const out = new Set();
  const re = /<a[^>]+href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const h = m[1];
    if (h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/_next/')) {
      // Strip query/hash for crawling purposes
      const clean = h.split('#')[0].split('?')[0];
      // Skip admin / workbench / api routes — public site only
      if (clean.startsWith('/admin') || clean.startsWith('/workbench') || clean.startsWith('/api')) continue;
      out.add(clean);
    }
  }
  return [...out];
}

function rewriteInternalLinks(html, currentPath) {
  const prefix = depthPrefix(currentPath);
  return html.replace(/<a([^>]+)href="(\/[^"]*)"/g, (full, attrs, href) => {
    if (href.startsWith('/_next/') || href.startsWith('/api/')) return full;
    if (href.startsWith('/admin') || href.startsWith('/workbench')) return full;
    const clean = href.split('#')[0].split('?')[0];
    const hashTail = href.includes('#') ? '#' + href.split('#')[1] : '';
    return `<a${attrs}href="${prefix}${rewriteHref(clean)}${hashTail}"`;
  });
}

let count = 0;
while (queue.length && count < MAX_PAGES) {
  const path = queue.shift();
  if (visited.has(path)) continue;
  visited.add(path);
  count++;

  const url = ORIGIN + path;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    if (!resp || !resp.ok()) {
      console.warn(`  · skip ${path} (${resp?.status()})`);
      continue;
    }
    await page.waitForTimeout(WAIT_MS);
  } catch (e) {
    console.warn(`  · failed ${path}: ${e.message}`);
    continue;
  }

  let html = await page.content();
  html = stripDynamic(html);

  // Discover new internal links before rewriting.
  for (const h of extractInternalHrefs(html)) {
    if (!visited.has(h)) queue.push(h);
  }

  html = rewriteInternalLinks(html, path);
  html = await inlineImages(html);
  html = html.replace('</head>', `<!-- snapshot path=${path} ${new Date().toISOString()} -->\n</head>`);

  const out = pathToFile(path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  console.log(`✓ [${count}] ${path.padEnd(40)} → ${out.replace(OUT_DIR, '')} (${(html.length / 1024).toFixed(1)} KB)`);
}

await browser.close();
console.log(`\ndone · ${count} pages written under ${OUT_DIR}`);
