// Generate promote/published-preview.html — a single self-contained HTML file
// snapshotting the current public site (home grid + sample article).
//
// Usage:  pnpm --filter @ch/web preview
//   or:   node apps/web/scripts/generate-preview.mjs
//
// Lives inside apps/web/ so ESM resolves `pg` via the workspace deps.
// Output is written to ch/promote/published-preview.html.

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny .env parser — avoids the dotenv dep so this script can run from any
// workspace package that has `pg` available.
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
// scripts/ → apps/web/ → apps/ → ch/.env
loadEnv(path.join(__dirname, '..', '..', '..', '.env'));

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const HOME_LIMIT = 60;          // cards on the home grid (snapshot)
const SAMPLE_ARTICLES = 6;      // full-text article samples shown below

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function main() {
  const items = (await pool.query(`
    SELECT
      i.id, i.slug, i.title, i.summary, i.category, i.published_at,
      i.cover_url, i.cover_sizes,
      r.media_urls,
      s.name AS source_name,
      r.url  AS source_url
    FROM items i
    JOIN sources s   ON s.id = i.source_id
    JOIN raw_items r ON r.id = i.raw_item_id
    WHERE i.status = 'PUBLISHED'
    ORDER BY i.published_at DESC NULLS LAST
    LIMIT ${HOME_LIMIT}
  `)).rows;

  const totalRow = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM items WHERE status='PUBLISHED'`,
  )).rows[0];
  const total = totalRow.n;

  const cats = (await pool.query(`
    SELECT category, COUNT(*)::int AS n FROM items
    WHERE status='PUBLISHED' AND category IS NOT NULL
    GROUP BY category ORDER BY n DESC
  `)).rows;

  const sources = (await pool.query(`
    SELECT s.name, s.platform, COUNT(i.id)::int AS n
    FROM sources s LEFT JOIN items i ON i.source_id=s.id AND i.status='PUBLISHED'
    GROUP BY s.id ORDER BY n DESC
  `)).rows;

  // ---- helpers ----
  const cardHtml = (a) => {
    const thumb = a.cover_sizes?.card || a.cover_url || a.media_urls?.[0] || '';
    return `
      <a class="card" href="#a-${escapeHtml(a.slug)}">
        ${thumb
          ? `<img loading="lazy" src="${escapeHtml(thumb)}" alt="" referrerpolicy="no-referrer"/>`
          : `<div class="thumb-blank"></div>`}
        <div class="card-body">
          ${a.category ? `<span class="cat">${escapeHtml(a.category)}</span>` : ''}
          <h2>${escapeHtml(a.title || '(无标题)')}</h2>
          ${a.summary ? `<p>${escapeHtml(a.summary).slice(0, 120)}</p>` : ''}
          <div class="meta">${escapeHtml(a.source_name)} · ${a.published_at ? new Date(a.published_at).toLocaleDateString('zh-CN') : ''}</div>
        </div>
      </a>`;
  };

  const articleHtml = (a) => {
    const cover = a.cover_url || a.media_urls?.[0] || '';
    const rest  = (a.media_urls || []).slice(cover === a.media_urls?.[0] ? 1 : 0);
    return `
      <article id="a-${escapeHtml(a.slug)}" class="article">
        <div class="art-meta">
          ${a.category ? `<span class="cat">${escapeHtml(a.category)}</span>` : ''}
          <span class="muted">${escapeHtml(a.source_name)}</span>
          ${a.published_at ? `<span class="muted">${new Date(a.published_at).toLocaleString('zh-CN')}</span>` : ''}
          <a class="muted" href="${escapeHtml(a.source_url)}" target="_blank" rel="noreferrer">原文 ↗</a>
        </div>
        <h1>${escapeHtml(a.title || '(无标题)')}</h1>
        ${a.summary ? `<p class="summary">${escapeHtml(a.summary)}</p>` : ''}
        ${cover ? `<img class="art-cover" loading="lazy" src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer"/>` : ''}
        ${rest.length
          ? `<div class="gallery">${rest.map((u) => `<img loading="lazy" src="${escapeHtml(u)}" alt="" referrerpolicy="no-referrer"/>`).join('')}</div>`
          : ''}
      </article>`;
  };

  const sampleSet = items.slice(0, SAMPLE_ARTICLES);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>内容中台 · 已发布预览（${total} 篇）</title>
<style>
  :root {
    --fg: #111827; --muted: #6b7280; --faint: #9ca3af;
    --bg: #ffffff; --card: #ffffff; --line: #e5e7eb; --soft: #f9fafb;
    --accent: #2563eb;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    font-size: 14px; line-height: 1.6; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header.site {
    border-bottom: 1px solid var(--line); padding: 24px 32px;
    display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
  }
  header.site h1 { font-size: 22px; font-weight: 700; margin: 0; }
  header.site .sub { color: var(--muted); font-size: 13px; }

  section.stats {
    background: var(--soft); border-bottom: 1px solid var(--line);
    padding: 16px 32px; display: flex; flex-wrap: wrap; gap: 24px;
    font-size: 12px; color: var(--muted);
  }
  section.stats strong { color: var(--fg); font-size: 16px; font-weight: 700; margin-right: 4px; }
  section.stats .pill {
    display: inline-block; padding: 2px 9px; border: 1px solid var(--line);
    border-radius: 12px; background: #fff; margin-right: 6px;
  }

  main { max-width: 1280px; margin: 0 auto; padding: 24px 24px 80px; }
  h2.section-title { font-size: 16px; font-weight: 700; margin: 24px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }

  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
  .card {
    display: block; background: var(--card); border: 1px solid var(--line);
    border-radius: 8px; overflow: hidden; color: var(--fg);
  }
  .card:hover { border-color: var(--accent); text-decoration: none; }
  .card img, .card .thumb-blank {
    display: block; width: 100%; aspect-ratio: 3/2; object-fit: cover;
    background: var(--soft);
  }
  .card-body { padding: 12px 14px; }
  .card .cat { display: inline-block; font-size: 11px; color: var(--accent); margin-bottom: 4px; }
  .card h2 {
    font-size: 14px; font-weight: 600; margin: 0 0 6px; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card p { font-size: 12px; color: var(--muted); margin: 0 0 6px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card .meta { font-size: 11px; color: var(--faint); }

  .article {
    border-top: 1px solid var(--line); padding: 32px 0;
    max-width: 760px; margin: 0 auto;
  }
  .article h1 { font-size: 22px; font-weight: 700; margin: 8px 0 12px; }
  .article .art-meta { font-size: 12px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; }
  .article .summary {
    background: var(--soft); border-left: 3px solid var(--fg);
    padding: 10px 14px; border-radius: 4px; color: #374151;
  }
  .article .art-cover { width: 100%; border-radius: 6px; margin: 12px 0; background: var(--soft); }
  .article .gallery { display: flex; flex-direction: column; gap: 12px; }
  .article .gallery img { width: 100%; height: auto; border-radius: 6px; background: var(--soft); }
  .article .cat { color: var(--accent); }

  footer { text-align: center; padding: 32px 0; color: var(--faint); font-size: 11px; border-top: 1px solid var(--line); }

  @media (max-width: 640px) {
    .grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .card-body { padding: 8px 10px; }
    .card h2 { font-size: 13px; }
    main { padding: 16px 12px 60px; }
  }
</style>
</head>
<body>
  <header class="site">
    <h1>内容中台 · 公共站预览</h1>
    <span class="sub">9-Agent 流水线 · 已发布快照</span>
  </header>

  <section class="stats">
    <span><strong>${total}</strong>篇已发布</span>
    <span><strong>${cats.length}</strong>个分类</span>
    <span><strong>${sources.length}</strong>个采集源</span>
    <span style="margin-left:auto; color: var(--faint)">生成于 ${new Date().toLocaleString('zh-CN')}</span>
  </section>

  <main>
    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px;">
      ${cats.map(c => `<span class="pill" style="border:1px solid var(--line); padding:3px 10px; border-radius:14px; font-size:12px;">${escapeHtml(c.category)} · ${c.n}</span>`).join('')}
    </div>

    <h2 class="section-title">最新 ${items.length} 篇</h2>
    <div class="grid">
      ${items.map(cardHtml).join('')}
    </div>

    <h2 class="section-title">文章详情样例（前 ${sampleSet.length} 篇全文）</h2>
    ${sampleSet.map(articleHtml).join('')}
  </main>

  <footer>
    单文件快照 · 共 ${total} 篇 · 图片仍引用上游 CDN<br/>
    重新生成: <code>node promote/generate-preview.mjs</code>
  </footer>
</body>
</html>`;

  // Output to ch/promote/published-preview.html (sibling of workbench-preview.html)
  const out = path.join(__dirname, '..', '..', '..', 'promote', 'published-preview.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`✓ wrote ${out}`);
  console.log(`  total=${total} sampled=${items.length} sizeKB=${(html.length/1024).toFixed(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
