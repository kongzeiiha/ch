// Refresh promote/workbench-preview.html with a fresh SNAPSHOT block.
//
// The HTML file is a hand-coded mock of the workbench that reads its data
// from a `const SNAPSHOT = {...}` block between SNAPSHOT_BEGIN/SNAPSHOT_END
// markers. We just rewrite that block — all the rendering JS stays put.
//
// Usage:  pnpm --filter @ch/web snapshot
//   or:   node apps/web/scripts/snapshot-workbench.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMOTE_DIR = path.join(__dirname, '..', '..', '..', 'promote');
const PREVIEW_HTML = path.join(PROMOTE_DIR, 'workbench-preview.html');
const IMAGES_DIR = path.join(PROMOTE_DIR, 'images');
const API = process.env.API_URL ?? 'http://localhost:4000';

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → http=${r.status}`);
  return r.json();
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

/**
 * Build the right header set to defeat each platform's hotlink protection.
 *   - 2ksg / aizuyun / ylimg: needs Referer = uib.{mirror}/ + browser UA
 *   - knit:                   needs Cookie (cf_clearance) + matching UA
 *   - rss / html / others:    plain UA is enough
 */
function headersForSource(source) {
  const cfg = source?.config || {};
  const platform = source?.platform || '';
  if (platform === '2ksg') {
    return {
      'User-Agent': BROWSER_UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': cfg.referer || 'https://uib.2ksg.com/',
    };
  }
  if (platform === 'knit') {
    return {
      'User-Agent': cfg.userAgent || BROWSER_UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://xx.knit.bid/',
      ...(cfg.cookie ? { Cookie: cfg.cookie } : {}),
    };
  }
  return { 'User-Agent': BROWSER_UA };
}

function extFromUrlOrType(url, contentType) {
  const m = /\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i.exec(url);
  if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  return '.bin';
}

/**
 * Download one URL to promote/images/<sha>.<ext>. Returns the relative path
 * from promote/ (so HTML at promote/*.html can use it directly), or null on
 * failure. Skips if the file already exists (cache by URL hash).
 */
async function downloadOne(url, headers) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  // Find any existing cached version (matching prefix, any extension).
  const existing = fs.readdirSync(IMAGES_DIR).find((f) => f.startsWith(hash + '.'));
  if (existing) return `images/${existing}`;

  try {
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null; // hotlink-protected: 200 OK but empty body
    const ext = extFromUrlOrType(url, r.headers.get('content-type') || '');
    const file = `${hash}${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, file), buf);
    return `images/${file}`;
  } catch {
    return null;
  }
}

async function pMap(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

async function main() {
  console.log(`fetching live state from ${API} …`);

  const RAW_LIMIT = 200;   // how many raw_items thumbnails to embed
  const [
    state,
    sourcesRes,
    queuesRes,
    runsRes,
    liveRes,
    itemsRes,
    rawRes,
  ] = await Promise.all([
    getJson(`${API}/admin/pipeline/state`),
    getJson(`${API}/admin/sources`),
    getJson(`${API}/admin/day7/queues`),
    getJson(`${API}/admin/day7/agent-runs`),
    getJson(`${API}/admin/pipeline/live-jobs`),
    getJson(`${API}/admin/items?limit=12`).catch(() => ({ items: [] })),
    getJson(`${API}/admin/raw-items?with_media=1&limit=${RAW_LIMIT}`).catch(() => ({ items: [], total: 0 })),
  ]);

  // ── Download every media URL referenced by raw_items ───────────────────
  // Both 2ksg and knit aggressively block hotlinking from file:// (empty
  // body / 403). We mirror everything to promote/images/ and rewrite
  // media_urls to relative paths so the HTML works fully offline.
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const sourceById = new Map((sourcesRes.sources ?? []).map((s) => [s.id, s]));
  const allRefs = [];
  for (const it of (rawRes.items ?? [])) {
    for (const u of (it.media_urls ?? [])) {
      allRefs.push({ url: u, source: sourceById.get(it.source_id) });
    }
  }
  console.log(`downloading ${allRefs.length} media urls (8 concurrent) …`);
  const t0 = Date.now();
  let ok = 0, fail = 0;
  const urlMap = new Map(); // remote URL → local relative path
  await pMap(allRefs, 8, async ({ url, source }, i) => {
    const headers = headersForSource(source);
    const local = await downloadOne(url, headers);
    if (local) {
      urlMap.set(url, local);
      ok++;
    } else {
      fail++;
    }
    if ((i + 1) % 25 === 0) {
      process.stdout.write(`  ${i + 1}/${allRefs.length}  ok=${ok} fail=${fail}\r`);
    }
  });
  console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(1)}s · ok=${ok} fail=${fail}`);

  // Rewrite media_urls in the snapshot so HTML uses local paths.
  const rawItemsLocal = (rawRes.items ?? []).map((it) => ({
    ...it,
    media_urls: (it.media_urls ?? []).map((u) => urlMap.get(u) || u),
    media_urls_remote: it.media_urls ?? [], // keep for "open original" link
  }));

  const snapshot = {
    takenAt: new Date().toISOString().slice(0, 19),
    sources: (sourcesRes.sources ?? []).map((s) => ({
      id: s.id,
      platform: s.platform,
      external_id: s.external_id,
      name: s.name,
      url: s.url,
      status: s.status,
      score: s.score,
      last_fetch_at: s.last_fetch_at,
      config: s.config ?? {},
    })),
    pendingMap: state.pendingMap ?? {},
    globalStop: !!state.globalStop,
    agents: state.agents ?? {},
    queues: queuesRes.stats ?? [],
    summary: runsRes.summary ?? [],
    live: {
      active: liveRes.active ?? {},
      recent: liveRes.recent ?? {},
    },
    items: itemsRes.items ?? [],
    rawItems: rawItemsLocal,
    rawItemsTotal: rawRes.total ?? 0,
    mediaStats: { downloaded: ok, failed: fail, total: allRefs.length },
  };

  // Pretty-print so the diff stays readable.
  const block =
    '// SNAPSHOT_BEGIN\n' +
    'const SNAPSHOT = ' + JSON.stringify(snapshot, null, 2) + ';\n' +
    '// SNAPSHOT_END';

  const html = fs.readFileSync(PREVIEW_HTML, 'utf8');
  const updated = html.replace(
    /\/\/ SNAPSHOT_BEGIN[\s\S]*?\/\/ SNAPSHOT_END/,
    block,
  );
  if (updated === html) {
    throw new Error('SNAPSHOT_BEGIN/END markers not found in workbench-preview.html');
  }
  fs.writeFileSync(PREVIEW_HTML, updated, 'utf8');

  console.log(`✓ refreshed ${PREVIEW_HTML}`);
  console.log(`  takenAt    = ${snapshot.takenAt}`);
  console.log(`  sources    = ${snapshot.sources.length}`);
  console.log(`  agents     = ${Object.keys(snapshot.agents).length}`);
  console.log(`  queues     = ${snapshot.queues.length}`);
  console.log(`  summary    = ${snapshot.summary.length} agents`);
  const liveCount = Object.values(snapshot.live.recent).reduce((n, arr) => n + arr.length, 0);
  console.log(`  recent jobs= ${liveCount}`);
  console.log(`  raw items  = ${snapshot.rawItems.length}/${snapshot.rawItemsTotal}`);
  console.log(`  pendingMap = ${JSON.stringify(snapshot.pendingMap)}`);
  const imgsBytes = fs.readdirSync(IMAGES_DIR).reduce((n, f) => n + fs.statSync(path.join(IMAGES_DIR, f)).size, 0);
  console.log(`  images     = ${snapshot.mediaStats.downloaded} ok / ${snapshot.mediaStats.failed} fail · ${(imgsBytes / 1024 / 1024).toFixed(1)} MB on disk`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
