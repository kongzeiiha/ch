// Snapshot http://localhost:3000/workbench → standalone offline HTML.
// Loads the Next.js page in Playwright, clicks each tab, waits for the
// data fetch, then captures the rendered DOM. External scripts/links are
// stripped so the saved file works without the dev server. The workbench
// uses inline JSX styles for everything, so no CSS inlining is needed.
//
// Generates one snapshot per tab into promote/:
//   workbench-pipeline.html · workbench-sources.html
//   workbench-crawl.html    · workbench-queues.html
// Plus workbench-snapshot.html as the default (pipeline) view.

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL = process.env.SNAP_URL ?? 'http://localhost:3000/workbench';
const OUT_DIR = process.env.SNAP_OUT_DIR ?? resolve(process.cwd(), 'promote');
const WAIT_MS = Number(process.env.SNAP_WAIT_MS ?? 4000);

const TABS = [
  { key: 'pipeline', label: '流水线',     out: 'workbench-pipeline.html'  },
  { key: 'sources',  label: '采集源',     out: 'workbench-sources.html'   },
  { key: 'crawl',    label: '采集预览',   out: 'workbench-crawl.html'     },
  { key: 'queues',   label: '队列 & 成本', out: 'workbench-queues.html'   },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

console.log(`→ loading ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(WAIT_MS);

async function inlineImages(html) {
  // Find every <img src="..."> and replace with a base64 data: URI so the
  // saved HTML survives without the API/MinIO servers running.
  const urls = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const unique = [...new Set(urls)];
  const subs = new Map();
  for (const u of unique) {
    if (u.startsWith('data:')) continue;
    try {
      const decoded = u.replace(/&amp;/g, '&');
      const r = await page.request.get(decoded, { timeout: 8000 });
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

async function snapshot(label, outPath) {
  // Strip script/link tags inside the captured HTML so it loads without the dev server.
  let html = await page.content();
  html = html
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  html = await inlineImages(html);
  const frozen = html.replace('</head>',
    `<!-- workbench tab=${label} · frozen ${new Date().toISOString()} -->\n</head>`);
  await writeFile(outPath, frozen, 'utf8');
  console.log(`✓ ${label.padEnd(12)} → ${outPath} (${(frozen.length / 1024).toFixed(1)} KB)`);
}

for (const tab of TABS) {
  // Click the tab button (matches by visible text)
  await page.getByRole('button', { name: tab.label, exact: true }).click();
  // Tab content lazily fetches — give it a beat.
  await page.waitForTimeout(WAIT_MS);
  await snapshot(tab.label, resolve(OUT_DIR, tab.out));
}

// Default snapshot = pipeline (re-capture for consistency)
await page.getByRole('button', { name: '流水线', exact: true }).click();
await page.waitForTimeout(1000);
await snapshot('default', resolve(OUT_DIR, 'workbench-snapshot.html'));

await browser.close();
console.log('done');
