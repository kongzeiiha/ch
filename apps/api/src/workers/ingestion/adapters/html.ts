import axios from 'axios';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type { SourceAdapter, SourceRow, RawCandidate } from './types.js';
import { renderPage, type RenderOptions, type CookieDef } from '../renderer.js';

const http = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': 'ch-agents/0.1 (+ingestion)' },
  maxRedirects: 5,
});

const MAX_IMAGES_PER_PAGE = 20;
const MAX_IMAGES_PER_PAGE_UNFILTERED = 500;
const MIN_CONTEXT_CHARS = 20;

/**
 * HTML adapter. Three modes via `source.config.mode`:
 *
 *   - 'article'   (default): each URL in config.urls = 1 item (page = one article)
 *   - 'per-image':           each <img> on each URL = 1 item (image gallery mode)
 *   - 'crawl':               crawl from config.entry, follow same-host <a> links
 *                            up to maxDepth/maxPages, then per-image extract
 */
export const htmlAdapter: SourceAdapter = {
  platform: 'html',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const mode: 'article' | 'per-image' | 'crawl' =
      source.config.mode === 'per-image' ? 'per-image' :
      source.config.mode === 'crawl'     ? 'crawl' : 'article';
    const useBrowser = source.config.render === 'browser';
    const extractAll = source.config.extractAll === true;
    const renderOpts = renderOptionsFromConfig(source.config);
    const results: RawCandidate[] = [];

    if (mode === 'crawl') {
      const entry: string = source.config.entry || (source.config.urls?.[0] ?? source.url ?? '');
      if (!entry) return [];
      const maxDepth = Math.max(0, Math.min(5, Number(source.config.maxDepth ?? 2)));
      const maxPages = Math.max(1, Math.min(80, Number(source.config.maxPages ?? 30)));
      const patternStr = source.config.urlPattern as string | undefined;
      let urlPattern: RegExp | undefined;
      if (patternStr) {
        try { urlPattern = new RegExp(patternStr); } catch { /* ignore bad regex */ }
      }
      const pages = await crawlPages({ entry, maxDepth, maxPages, urlPattern, useBrowser, renderOpts });
      for (const { url, html } of pages) {
        results.push(...extractPerImage(html, url, { extractAll }));
      }
      return results;
    }

    const urls: string[] = source.config.urls ?? [];
    for (const url of urls) {
      const safe = (() => { try { return new URL(url).toString(); } catch { return url; } })();
      let html: string;
      try {
        if (useBrowser) {
          html = await renderPage(safe, renderOpts);
        } else {
          const res = await http.get<string>(safe, { responseType: 'text' });
          html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        }
      } catch (e: any) {
        console.warn(`[html] fetch fail ${url}: ${e?.message}`);
        continue;
      }

      if (mode === 'per-image') {
        results.push(...extractPerImage(html, safe, { extractAll }));
      } else {
        results.push({ url: safe, externalId: url, html });
      }
    }
    return results;
  },
};

/**
 * Translate optional source.config knobs into Playwright RenderOptions.
 * All fields are optional — if none are set, renderPage uses its defaults.
 *
 *   render:           'browser' enables stealth Playwright (set elsewhere)
 *   waitForSelector:  e.g. 'img[src]' or '.gallery img' to wait for content
 *   userAgent:        override the default Chrome UA (rarely needed)
 *   cookies:          [{name, value, domain, path?}, ...] for logged-in sites
 *   extraHeaders:     arbitrary HTTP headers (e.g. cf-clearance from a session)
 *   locale:           e.g. 'zh-CN' — affects Accept-Language and JS Intl
 *   timezone:         e.g. 'Asia/Shanghai' — affects new Date() / Intl.format
 *   renderTimeoutMs:  goto/waitFor timeout, default 25_000
 *   renderSettleMs:   sleep after networkidle/selector, default 1_200
 */
function renderOptionsFromConfig(cfg: Record<string, any>): RenderOptions {
  const cookies: CookieDef[] | undefined = Array.isArray(cfg.cookies)
    ? cfg.cookies.filter((c: any) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
    : undefined;
  const extraHeaders: Record<string, string> | undefined =
    cfg.extraHeaders && typeof cfg.extraHeaders === 'object' ? cfg.extraHeaders : undefined;
  return {
    waitForSelector: typeof cfg.waitForSelector === 'string' ? cfg.waitForSelector : undefined,
    userAgent: typeof cfg.userAgent === 'string' ? cfg.userAgent : undefined,
    locale: typeof cfg.locale === 'string' ? cfg.locale : undefined,
    timezoneId: typeof cfg.timezone === 'string' ? cfg.timezone : undefined,
    timeoutMs: cfg.renderTimeoutMs ? Number(cfg.renderTimeoutMs) : undefined,
    settleMs: cfg.renderSettleMs !== undefined ? Number(cfg.renderSettleMs) : undefined,
    cookies,
    extraHeaders,
  };
}

/**
 * Same-host BFS crawler with per-level concurrency. Each depth level fetches
 * up to `concurrency` pages in parallel, harvests their links, then dives
 * into the next level. Stops at maxDepth or maxPages, whichever first.
 */
async function crawlPages(opts: {
  entry: string;
  maxDepth: number;
  maxPages: number;
  urlPattern?: RegExp;
  useBrowser: boolean;
  renderOpts?: RenderOptions;
  concurrency?: number;
}): Promise<Array<{ url: string; html: string }>> {
  const { entry, maxDepth, maxPages, urlPattern, useBrowser, renderOpts } = opts;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? (useBrowser ? 4 : 8)));
  let entryHost: string;
  try { entryHost = new URL(entry).host; } catch { return []; }

  const visited = new Set<string>();
  const out: Array<{ url: string; html: string }> = [];

  let frontier: string[] = [entry];
  let depth = 0;

  console.log(`[crawl] start entry=${entry} maxDepth=${maxDepth} maxPages=${maxPages} concurrency=${concurrency}`);

  while (frontier.length && out.length < maxPages && depth <= maxDepth) {
    // 1. dedup + cap by remaining budget
    const remaining = maxPages - out.length;
    const todo = frontier.filter((u) => !visited.has(u)).slice(0, remaining);
    for (const u of todo) visited.add(u);
    if (!todo.length) break;

    console.log(`[crawl] depth=${depth} fetching ${todo.length} pages (${concurrency} parallel)`);

    // 2. fetch this level in parallel batches of `concurrency`
    const fetched: Array<{ url: string; html: string }> = [];
    for (let i = 0; i < todo.length; i += concurrency) {
      const batch = todo.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (url) => {
        try {
          const html = useBrowser
            ? await renderPage(url, renderOpts)
            : String((await http.get<string>(url, { responseType: 'text' })).data ?? '');
          return { url, html };
        } catch (e: any) {
          console.warn(`[crawl] fail ${url}: ${e?.message}`);
          return null;
        }
      }));
      for (const r of results) if (r) fetched.push(r);
    }
    out.push(...fetched);
    console.log(`[crawl]   depth=${depth} got ${fetched.length}/${todo.length}, total=${out.length}`);

    if (depth >= maxDepth) break;
    if (out.length >= maxPages) break;

    // 3. harvest next-level links from this batch's pages
    const nextSet = new Set<string>();
    for (const { url, html } of fetched) {
      const dom = new JSDOM(html, { url });
      const anchors = Array.from(dom.window.document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = (a as any).href as string;
        if (!href) continue;
        let abs: string;
        try { abs = new URL(href, url).toString().split('#')[0]; } catch { continue; }
        if (visited.has(abs) || nextSet.has(abs)) continue;
        try { if (new URL(abs).host !== entryHost) continue; } catch { continue; }
        if (!/^https?:/i.test(abs)) continue;
        if (urlPattern && !urlPattern.test(abs)) continue;
        nextSet.add(abs);
      }
    }
    frontier = Array.from(nextSet);
    depth++;
  }

  console.log(`[crawl] done visited=${visited.size} pages=${out.length}`);
  return out;
}

function extractPerImage(html: string, pageUrl: string, opts: { extractAll?: boolean } = {}): RawCandidate[] {
  const dom = new JSDOM(html, { url: pageUrl });
  const doc = dom.window.document;
  const extractAll = opts.extractAll === true;

  const pageTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent?.trim() ||
    'Untitled';

  const results: RawCandidate[] = [];
  const seen = new Set<string>();
  let ordinal = 0;
  const cap = extractAll ? MAX_IMAGES_PER_PAGE_UNFILTERED : MAX_IMAGES_PER_PAGE;

  // Collect candidate (img, url) pairs. In extractAll mode we also pull from
  // srcset / <picture><source> / data-srcset to get every image variant the
  // page references.
  const candidates: Array<{ img: Element; url: string }> = [];
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const urls = collectImgUrls(img, extractAll);
    for (const u of urls) candidates.push({ img, url: u });
  }
  if (extractAll) {
    for (const src of Array.from(doc.querySelectorAll('picture source[srcset], picture source[data-srcset]'))) {
      const sset = src.getAttribute('srcset') || src.getAttribute('data-srcset') || '';
      for (const u of parseSrcset(sset)) {
        // Attach to enclosing <picture>'s <img> for context, if any.
        const pic = src.closest('picture');
        const fakeImg = pic?.querySelector('img') ?? src;
        candidates.push({ img: fakeImg, url: u });
      }
    }
  }

  for (const { img, url: rawSrc } of candidates) {
    if (results.length >= cap) break;
    if (!rawSrc) continue;

    let absUrl: string;
    try { absUrl = new URL(rawSrc, pageUrl).toString(); } catch { continue; }
    if (!/^https?:/i.test(absUrl)) continue;

    if (!extractAll) {
      // Filter out obvious non-content images (icons, tracking pixels, SVG logos).
      if (/\.(svg|ico)(\?|$)/i.test(absUrl)) continue;
      if (/(sprite|icon|logo|pixel|tracking|avatar|emoji)/i.test(absUrl)) continue;
      // Cheap size hints — skip 1x1 / obviously small.
      const w = parseInt(img.getAttribute('width') ?? '0', 10);
      const h = parseInt(img.getAttribute('height') ?? '0', 10);
      if (w && w < 200) continue;
      if (h && h < 150) continue;
    }

    if (seen.has(absUrl)) continue;
    seen.add(absUrl);
    ordinal++;

    // Gather context: figcaption > alt > surrounding text.
    const alt = (img.getAttribute('alt') ?? '').trim();
    const title = (img.getAttribute('title') ?? '').trim();
    const fig = img.closest('figure');
    const figcap = fig?.querySelector('figcaption')?.textContent?.trim() ?? '';
    const parent = img.closest('p, figure, div, section');
    const nearby = (parent?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);

    const caption = figcap || alt || title;
    const parts = [
      caption,
      nearby && nearby !== caption ? nearby : '',
      `来自：${pageTitle}`,
    ].filter(Boolean);
    const text = parts.join('\n\n').slice(0, 500);

    if (!extractAll && text.length < MIN_CONTEXT_CHARS) continue;

    const displayTitle =
      caption || `${pageTitle} · 图 ${ordinal}`;
    // Unique externalId per image (even if the same image appears on
    // multiple pages, dedup picks it up only once).
    const externalId = createHash('sha256').update(absUrl).digest('hex').slice(0, 40);

    results.push({
      url: absUrl,
      externalId,
      title: displayTitle,
      text: text || `来自：${pageTitle}`,
      mediaUrls: [absUrl],
      skipSimhash: true,
      extra: { sourcePage: pageUrl, imageIndex: ordinal, pageTitle },
    });
  }

  return results;
}

function collectImgUrls(img: Element, includeSrcset: boolean): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => { if (s) out.push(s.trim()); };
  push(img.getAttribute('src'));
  push(img.getAttribute('data-src'));
  push(img.getAttribute('data-original'));
  push(img.getAttribute('data-lazy-src'));
  if (includeSrcset) {
    out.push(...parseSrcset(img.getAttribute('srcset') || ''));
    out.push(...parseSrcset(img.getAttribute('data-srcset') || ''));
  }
  return out.filter(Boolean);
}

// Parse a `srcset` value into URLs, ignoring the width/density descriptors.
//   "a.jpg 1x, b.jpg 2x"  →  ["a.jpg", "b.jpg"]
//   "a.jpg 320w, b.jpg 640w" → ["a.jpg", "b.jpg"]
function parseSrcset(s: string): string[] {
  if (!s) return [];
  return s.split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}
