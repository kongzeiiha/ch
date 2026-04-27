// Generate promote/crawl-preview.html — a standalone offline-viewable
// crawl-preview gallery showing every raw_item's image AND playable video.
//
// What it does:
//   1. Read raw_items + their source config (cookie/referer needed to bypass
//      hotlink protection on Twitter / 2ksg / knit CDNs).
//   2. Download every poster image to promote/images/<sha>.<ext>.
//   3. Download every video (extra.videoUrls) to promote/videos/<sha>.mp4.
//   4. Emit a self-contained HTML that uses relative paths:
//      - <img src="images/...jpg">
//      - <video src="videos/...mp4" controls>  with poster
//      - lightbox click-to-zoom for both
//
// Usage:  pnpm --filter @ch/web crawl-preview
//   or:   node apps/web/scripts/generate-crawl-preview.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMOTE = path.join(__dirname, '..', '..', '..', 'promote');
const IMAGES = path.join(PROMOTE, 'images');
const VIDEOS = path.join(PROMOTE, 'videos');
const OUT_HTML = path.join(PROMOTE, 'crawl-preview.html');

// Tiny .env loader so we don't need dotenv installed
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(__dirname, '..', '..', '..', '.env'));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — copy .env.example to .env or export it inline.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const RAW_LIMIT = 200;
const VIDEO_BYTES_LIMIT = 80 * 1024 * 1024; // 80 MB cap per file
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const looksLikeVideo = (u) => VIDEO_URL_RE.test(u || '');

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function headersForSource(source) {
  const cfg = source?.config || {};
  const platform = source?.platform || '';
  const ua = cfg.userAgent || BROWSER_UA;
  const base = { 'User-Agent': ua, 'Accept': 'image/avif,image/webp,image/*,video/*,*/*;q=0.8' };
  if (platform === '2ksg')   return { ...base, Referer: cfg.referer || 'https://uib.2ksg.com/' };
  if (platform === 'knit')   return { ...base, Referer: 'https://xx.knit.bid/', ...(cfg.cookie ? { Cookie: cfg.cookie } : {}) };
  if (platform === 'x')      return { ...base, Referer: 'https://x.com/',       ...(cfg.cookie ? { Cookie: cfg.cookie } : {}) };
  return base;
}

function extOf(url, ct) {
  const m = /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)(\?|$)/i.exec(url);
  if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  if (ct?.includes('jpeg')) return '.jpg';
  if (ct?.includes('png'))  return '.png';
  if (ct?.includes('webp')) return '.webp';
  if (ct?.includes('mp4'))  return '.mp4';
  if (ct?.includes('webm')) return '.webm';
  return '.bin';
}

async function downloadOnce(remoteUrl, headers, outDir, sizeCap) {
  const hash = crypto.createHash('sha1').update(remoteUrl).digest('hex').slice(0, 16);
  const existing = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).find(f => f.startsWith(hash + '.'))
    : null;
  if (existing) return path.basename(outDir) + '/' + existing;

  try {
    const res = await fetch(remoteUrl, { headers, redirect: 'follow' });
    if (!res.ok) return null;
    const cl = res.headers.get('content-length');
    if (cl && Number(cl) > sizeCap) {
      console.warn(`  skip ${remoteUrl.slice(0, 80)} (${(Number(cl)/1024/1024).toFixed(1)}MB > cap)`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    if (buf.length > sizeCap) {
      console.warn(`  skip oversize ${(buf.length/1024/1024).toFixed(1)}MB`);
      return null;
    }
    const ext = extOf(remoteUrl, res.headers.get('content-type') || '');
    const file = `${hash}${ext}`;
    fs.writeFileSync(path.join(outDir, file), buf);
    return path.basename(outDir) + '/' + file;
  } catch (e) {
    console.warn(`  fail ${remoteUrl.slice(0, 80)}: ${e?.message}`);
    return null;
  }
}

async function pMap(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function main() {
  fs.mkdirSync(IMAGES, { recursive: true });
  fs.mkdirSync(VIDEOS, { recursive: true });

  console.log('querying raw_items …');
  const items = (await pool.query(`
    SELECT
      r.id, r.url, r.fetched_at, r.media_urls, r.dedupe_key,
      r.raw_payload->'extra' AS extra,
      COALESCE(r.raw_payload->>'title', '') AS title,
      s.id AS source_id, s.name AS source_name, s.platform, s.config AS source_config
    FROM raw_items r
    JOIN sources s ON s.id = r.source_id
    WHERE array_length(r.media_urls, 1) > 0
    ORDER BY r.fetched_at DESC
    LIMIT $1
  `, [RAW_LIMIT])).rows;

  console.log(`got ${items.length} raw_items`);
  const sourceFor = new Map(items.map(it => [it.source_id, { platform: it.platform, config: it.source_config || {} }]));

  // ── Collect unique URLs (dedupe by URL across items so okI/okV match disk) ──
  // Legacy data: some early X items wrote .mp4/.webm directly into media_urls,
  // those go into vidRefs even though they appear in the "image" array.
  const imgUrlMap = new Map(); // url → source (first item wins for headers)
  const vidUrlMap = new Map();
  for (const it of items) {
    const src = sourceFor.get(it.source_id);
    for (const u of (it.media_urls || [])) {
      if (looksLikeVideo(u)) {
        if (!vidUrlMap.has(u)) vidUrlMap.set(u, src);
      } else if (!imgUrlMap.has(u)) imgUrlMap.set(u, src);
    }
    const sidecars = (it.extra && Array.isArray(it.extra.videoUrls)) ? it.extra.videoUrls : [];
    for (const u of sidecars) {
      if (!vidUrlMap.has(u)) vidUrlMap.set(u, src);
    }
  }
  const imgRefs = [...imgUrlMap.entries()].map(([url, source]) => ({ url, source }));
  const vidRefs = [...vidUrlMap.entries()].map(([url, source]) => ({ url, source }));

  // ── Pass 1: download every poster image ──────────────────────────────
  console.log(`downloading ${imgRefs.length} unique images (8 concurrent) …`);
  const t0 = Date.now();
  let okI = 0, failI = 0;
  const imgMap = new Map();
  await pMap(imgRefs, 8, async ({ url, source }) => {
    const local = await downloadOnce(url, headersForSource(source), IMAGES, 6 * 1024 * 1024);
    if (local) { imgMap.set(url, local); okI++; } else failI++;
  });
  console.log(`  done images in ${((Date.now() - t0)/1000).toFixed(1)}s · ok=${okI} fail=${failI}`);

  // ── Pass 2: download every video (sidecar + legacy in-media_urls) ────
  console.log(`downloading ${vidRefs.length} unique videos (4 concurrent, 80MB cap) …`);
  const t1 = Date.now();
  let okV = 0, failV = 0;
  const vidMap = new Map();
  await pMap(vidRefs, 4, async ({ url, source }) => {
    const local = await downloadOnce(url, headersForSource(source), VIDEOS, VIDEO_BYTES_LIMIT);
    if (local) { vidMap.set(url, local); okV++; } else failV++;
  });
  console.log(`  done videos in ${((Date.now() - t1)/1000).toFixed(1)}s · ok=${okV} fail=${failV}`);

  // ── Build HTML ───────────────────────────────────────────────────────
  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const cards = items.map((it, idx) => {
    const remote = it.media_urls || [];
    const sidecars = (it.extra && Array.isArray(it.extra.videoUrls)) ? it.extra.videoUrls : [];

    const tiles = remote.map((origUrl, i) => {
      // Case A — legacy: media_urls itself is a video URL (.mp4/.webm/...)
      if (looksLikeVideo(origUrl)) {
        const vLocal = vidMap.get(origUrl);
        if (!vLocal) {
          // Couldn't download → render a non-clickable "video unavailable" tile.
          return `
        <div class="thumb thumb-broken" title="${escHtml(origUrl)}">
          <div class="fb-static">视频未下载</div>
        </div>`;
        }
        return `
        <div class="thumb thumb-video-only"
          data-video="${escHtml(vLocal)}"
          data-orig="${escHtml(origUrl)}"
          title="${escHtml(origUrl)}">
          <div class="video-icon">🎥</div>
        </div>`;
      }

      // Case B — image (possibly with sidecar video).
      const localImg = imgMap.get(origUrl);
      const imgSrc = localImg || origUrl; // remote fallback may load if browser is online
      const sidecarUrl = sidecars[i] ?? sidecars[0]; // X posts often have 1 video for N images
      const localVideo = sidecarUrl ? vidMap.get(sidecarUrl) : null;
      const hasPlayable = !!localVideo; // ← ONLY when local file exists
      return `
        <div class="thumb"
          data-img="${escHtml(imgSrc)}"
          data-orig="${escHtml(origUrl)}"
          ${hasPlayable ? `data-video="${escHtml(localVideo)}"` : ''}
          title="${escHtml(origUrl)}">
          <img loading="lazy" referrerpolicy="no-referrer" src="${escHtml(imgSrc)}" alt=""
               onerror="this.style.opacity=.2;this.parentElement.querySelector('.fb').style.display='flex'"/>
          <div class="fb">加载失败</div>
          ${hasPlayable ? '<div class="play-badge"></div>' : ''}
        </div>`;
    }).join('');

    return `
    <article class="card" data-idx="${idx}">
      <header class="card-meta">
        <span class="card-title" title="${escHtml(it.title || it.url || '')}">${escHtml(it.title || it.url || '(无标题)')}</span>
        <span class="chip platform-${escHtml(it.platform)}">${escHtml(it.platform)}</span>
        <span class="muted">${escHtml(it.source_name)}</span>
        <span class="faint">${fmtTime(it.fetched_at)}</span>
        ${it.url ? `<a class="muted" href="${escHtml(it.url)}" target="_blank" rel="noreferrer">↗ 原文</a>` : ''}
      </header>
      <div class="thumb-grid">${tiles}</div>
    </article>`;
  }).join('');

  // Stats per platform
  const byPlatform = {};
  for (const it of items) {
    const p = it.platform;
    if (!byPlatform[p]) byPlatform[p] = { rows: 0, imgs: 0, vids: 0 };
    byPlatform[p].rows++;
    byPlatform[p].imgs += (it.media_urls || []).length;
    byPlatform[p].vids += ((it.extra && Array.isArray(it.extra.videoUrls)) ? it.extra.videoUrls.length : 0);
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>采集预览 · ${items.length} 条 raw_items</title>
<style>
  :root {
    --bg: #0f172a; --card: #1e293b; --card-hi: #0b1322;
    --fg: #e2e8f0; --muted: #94a3b8; --faint: #64748b; --line: #334155;
    --accent: #6366f1; --green: #22c55e; --amber: #f59e0b; --blue: #60a5fa;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "PingFang SC", sans-serif; font-size: 14px; line-height: 1.6; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header.top {
    background: #020617; border-bottom: 1px solid var(--line);
    padding: 14px 24px; display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
    position: sticky; top: 0; z-index: 50;
  }
  header.top h1 { font-size: 16px; font-weight: 700; margin: 0; }
  header.top .stat { font-size: 12px; color: var(--muted); }
  header.top .stat strong { color: var(--fg); font-weight: 700; }
  header.top .stat.platform { padding: 2px 9px; border: 1px solid var(--line); border-radius: 12px; }

  .toolbar {
    background: var(--card); padding: 10px 24px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .toolbar select, .toolbar input[type=text] {
    background: var(--card-hi); border: 1px solid var(--line); border-radius: 6px;
    padding: 5px 10px; color: var(--fg); font-size: 12px;
  }
  .toolbar label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; }

  main { max-width: 1280px; margin: 0 auto; padding: 16px 16px 80px; }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
  .card-meta { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 10px; }
  .card-title { flex: 1; min-width: 200px; font-size: 13px; font-weight: 600; color: #f1f5f9;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 6px; }
  .chip.platform-x      { background: #71717a33; color: #e4e4e7; }
  .chip.platform-knit   { background: #f59e0b33; color: #fde68a; }
  .chip.platform-2ksg   { background: #ec489933; color: #fbcfe8; }
  .chip.platform-html   { background: #14b8a633; color: #99f6e4; }
  .chip.platform-rss    { background: #6366f133; color: #c7d2fe; }
  .chip.platform-reddit { background: #f9731633; color: #fed7aa; }
  .chip.platform-bluesky{ background: #38bdf833; color: #bae6fd; }
  .chip.platform-sitemap-images { background: #84cc1633; color: #d9f99d; }
  .muted { color: var(--muted); font-size: 11px; }
  .faint { color: var(--faint); font-size: 11px; }

  .thumb-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px;
  }
  .thumb {
    position: relative; aspect-ratio: 4/3; border-radius: 6px; overflow: hidden;
    background: var(--card-hi); border: 1px solid var(--line); cursor: pointer;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .fb {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    font-size: 11px; color: var(--faint);
  }
  .thumb-video-only {
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 6px;
  }
  .thumb-video-only .video-icon { font-size: 36px; }
  .thumb-broken {
    cursor: default;
    display: flex; align-items: center; justify-content: center;
  }
  .thumb-broken .fb-static {
    font-size: 11px; color: var(--faint); text-align: center; padding: 8px;
  }
  .play-badge {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .play-badge::after {
    content: '▶'; background: rgba(0,0,0,.6); border-radius: 50%; width: 42px; height: 42px;
    display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px;
  }

  /* Lightbox */
  #lb {
    position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 1000;
    display: none; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out;
  }
  #lb.open { display: flex; }
  #lb .panel { max-width: 92vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px; cursor: default; }
  #lb img, #lb video { max-width: 92vw; max-height: 80vh; border-radius: 8px; background: #000; object-fit: contain; }
  #lb .url-box {
    font-size: 11px; color: #cbd5e1; word-break: break-all; background: var(--card);
    padding: 6px 10px; border-radius: 6px;
  }
  #lb .url-box a { color: #93c5fd; }

  footer { color: var(--faint); font-size: 11px; padding: 24px 0; text-align: center; border-top: 1px solid var(--line); }
</style>
</head>
<body>

<header class="top">
  <h1>采集预览</h1>
  <span class="stat"><strong>${items.length}</strong> 条 raw_items</span>
  <span class="stat"><strong>${okI}</strong> 张图片下载到本地</span>
  <span class="stat"><strong>${okV}</strong> 个视频下载到本地</span>
  ${Object.entries(byPlatform).map(([p, s]) => `
    <span class="stat platform">${escHtml(p)} · <strong>${s.rows}</strong> 条 / ${s.imgs} 图${s.vids ? ' / ' + s.vids + ' 视频' : ''}</span>
  `).join('')}
  <span class="stat" style="margin-left:auto;color:var(--faint)">生成于 ${new Date().toLocaleString('zh-CN')}</span>
</header>

<div class="toolbar">
  <select id="filter-platform">
    <option value="">所有平台</option>
    ${Object.keys(byPlatform).map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('')}
  </select>
  <label><input type="checkbox" id="filter-video"/> 仅显示带视频的</label>
  <input type="text" id="filter-text" placeholder="标题/来源 关键词..." style="flex:1;min-width:200px;max-width:400px"/>
  <span class="muted" id="visible-count">显示 ${items.length} / ${items.length}</span>
</div>

<main id="cards">
  ${cards}
</main>

<div id="lb">
  <div class="panel" onclick="event.stopPropagation()">
    <div id="lb-media"></div>
    <div class="url-box" id="lb-url"></div>
  </div>
</div>

<footer>
  单文件离线预览 · 图片 ${okI}/${imgRefs.length}、视频 ${okV}/${vidRefs.length} 已下载到本地<br/>
  重新生成: <code>pnpm --filter @ch/web crawl-preview</code>
</footer>

<script>
  // Lightbox: click thumb → image or video. DOM-API only (no innerHTML
  // string concatenation) so URL edge-cases can't break the markup.
  const lb = document.getElementById('lb');
  const lbMedia = document.getElementById('lb-media');
  const lbUrl = document.getElementById('lb-url');

  function makeLink(href, label) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = label || href;
    return a;
  }
  function closeLb() {
    lb.classList.remove('open');
    lbMedia.replaceChildren(); // stops any playing video
    lbUrl.replaceChildren();
  }
  function openThumb(t) {
    const video = t.dataset.video;
    const img = t.dataset.img;
    const orig = t.dataset.orig;
    if (!video && !img) return; // broken tile — nothing to show
    lbMedia.replaceChildren();
    lbUrl.replaceChildren();
    if (video) {
      const v = document.createElement('video');
      v.controls = true; v.autoplay = true; v.muted = true; // muted is required for autoplay
      v.src = video;
      if (img) v.poster = img;
      lbMedia.appendChild(v);
      lbUrl.appendChild(document.createTextNode('视频: '));
      lbUrl.appendChild(makeLink(video));
      if (orig && orig !== video) {
        lbUrl.appendChild(document.createElement('br'));
        lbUrl.appendChild(document.createTextNode('原始: '));
        lbUrl.appendChild(makeLink(orig));
      }
    } else {
      const im = document.createElement('img');
      im.src = img;
      lbMedia.appendChild(im);
      lbUrl.appendChild(document.createTextNode('原始 URL: '));
      lbUrl.appendChild(makeLink(orig || img));
    }
    lb.classList.add('open');
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('.thumb');
    if (!t || t.classList.contains('thumb-broken')) return;
    openThumb(t);
  });
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

  // Filters
  const fp = document.getElementById('filter-platform');
  const fv = document.getElementById('filter-video');
  const ft = document.getElementById('filter-text');
  const vc = document.getElementById('visible-count');
  function applyFilters() {
    const platform = fp.value;
    const onlyVideo = fv.checked;
    const text = ft.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.card');
    let visible = 0;
    cards.forEach(c => {
      let ok = true;
      const chip = c.querySelector('.chip');
      const cardPlatform = chip?.textContent?.trim() || '';
      if (platform && cardPlatform !== platform) ok = false;
      if (onlyVideo && !c.querySelector('.thumb[data-video]')) ok = false;
      if (text && !c.textContent.toLowerCase().includes(text)) ok = false;
      c.style.display = ok ? '' : 'none';
      if (ok) visible++;
    });
    vc.textContent = '显示 ' + visible + ' / ' + cards.length;
  }
  fp.addEventListener('change', applyFilters);
  fv.addEventListener('change', applyFilters);
  ft.addEventListener('input', applyFilters);
</script>

</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log(`✓ wrote ${OUT_HTML} (${(html.length/1024).toFixed(1)} KB)`);

  const imagesBytes = fs.readdirSync(IMAGES).reduce((n, f) => n + fs.statSync(path.join(IMAGES, f)).size, 0);
  const videosBytes = fs.existsSync(VIDEOS)
    ? fs.readdirSync(VIDEOS).reduce((n, f) => n + fs.statSync(path.join(VIDEOS, f)).size, 0) : 0;
  console.log(`  images on disk: ${(imagesBytes/1024/1024).toFixed(1)} MB`);
  console.log(`  videos on disk: ${(videosBytes/1024/1024).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
