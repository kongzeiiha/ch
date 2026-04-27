import axios from 'axios';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';

/**
 * Adapter for knit.bid / lovecutes / MissKON family of numbered-gallery sites.
 *
 * The article page (e.g. /article/30689/) is rendered server-side, but only
 * the first dozen images appear inline; the rest follow the same path/filename
 * pattern with a zero-padded counter (001..NNN). Total count is announced in
 * the page <title>: "...80P".
 *
 * Strategy: GET the HTML (with cf_clearance cookie to pass Cloudflare), find
 * the gallery directory + filename template from any in-page <img>, parse the
 * total from the title, then generate the full 1..N URL list.
 *
 * No HEAD verification — generated URLs share the same directory as ones we
 * already saw work, so the cost of an occasional 404 (gallery short by a few
 * images) is much lower than 80 sequential probes.
 */

interface Config {
  urls?: string[];     // article URLs to ingest
  cookie?: string;     // browser cookie string (must include cf_clearance)
  userAgent?: string;  // UA must match the cookie's session
  /** Override total when title doesn't say "NN P". Default falls back to count of images found in HTML. */
  forceTotal?: number;
}

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const http = axios.create({
  timeout: 25_000,
  validateStatus: () => true,
});

export const knitAdapter: SourceAdapter = {
  platform: 'knit',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    const cookie = cfg.cookie || '';
    const userAgent = cfg.userAgent || DEFAULT_UA;
    const urls = Array.isArray(cfg.urls) ? cfg.urls.filter(Boolean) : [];

    if (!urls.length) {
      console.warn(`[knit] source ${source.id} has no urls`);
      return [];
    }
    if (!cookie) {
      console.warn(`[knit] source ${source.id} has no cookie — Cloudflare will block`);
    }

    const out: RawCandidate[] = [];
    let authRejects = 0;
    let attempted = 0;

    for (const articleUrl of urls) {
      const u = (() => { try { return new URL(articleUrl); } catch { return null; } })();
      if (!u) { console.warn(`[knit] bad url ${articleUrl}`); continue; }
      attempted++;

      let html: string;
      try {
        const res = await http.get<string>(articleUrl, {
          responseType: 'text',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': userAgent,
            ...(cookie ? { Cookie: cookie } : {}),
          },
        });
        // Cloudflare rejects expired/missing cf_clearance with 403 (rule block)
        // or 503 (challenge page). Either signals stale credentials.
        if (res.status === 403 || res.status === 503) {
          authRejects++;
          console.warn(`[knit] ${articleUrl} http=${res.status} (CF likely rejected cookie)`);
          continue;
        }
        if (res.status !== 200) {
          console.warn(`[knit] ${articleUrl} http=${res.status}`);
          continue;
        }
        html = String(res.data ?? '');
      } catch (e: any) {
        // ECONNRESET on TLS handshake = CF identified us as a bot before
        // even sending headers — count as auth reject.
        const msg = String(e?.message ?? '');
        if (/ECONNRESET|connection reset|TLS|fingerprint/i.test(msg)) {
          authRejects++;
        }
        console.warn(`[knit] ${articleUrl} fail: ${msg}`);
        continue;
      }

      const dom = new JSDOM(html, { url: articleUrl });
      const doc = dom.window.document;
      const pageTitle = (doc.querySelector('title')?.textContent || '').trim();
      const galleryName = pageTitle.split(' - ').slice(0, 3).join(' - ') || pageTitle || articleUrl;

      // Find every img URL on the page, prefer absolute. Filter to ones whose
      // path looks like a gallery image: contains "/static/images/<date>/...".
      const seen = new Set<string>();
      const candidates: string[] = [];
      for (const img of Array.from(doc.querySelectorAll('img'))) {
        for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
          const v = img.getAttribute(attr);
          if (!v) continue;
          let abs: string;
          try { abs = new URL(v, articleUrl).toString(); } catch { continue; }
          if (!/\/static\/images\//i.test(abs)) continue;
          if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(abs)) continue;
          if (seen.has(abs)) continue;
          seen.add(abs);
          candidates.push(abs);
        }
      }

      if (!candidates.length) {
        console.warn(`[knit] ${articleUrl} no gallery images found in HTML`);
        continue;
      }

      // Pick the dominant gallery directory (the one with the most images).
      // Other entries are recommendation thumbnails from different galleries.
      const byDir = new Map<string, string[]>();
      for (const c of candidates) {
        const dir = c.replace(/\/[^/]*$/, '/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(c);
      }
      let bestDir = '';
      let bestList: string[] = [];
      for (const [dir, list] of byDir) {
        if (list.length > bestList.length) { bestDir = dir; bestList = list; }
      }

      // Extract the zero-padded counter pattern from one of the gallery files.
      // Filename like: "Cosplayer-every-year-Nnian-Huanxisha-lovecutes.com-001.jpg"
      const sample = bestList[0];
      const pad = sample.match(/-(\d{2,4})\.(jpe?g|png|webp|gif)(\?|$)/i);
      let allUrls: string[] = bestList;
      let inferred = false;

      if (pad) {
        const [, numStr, ext] = pad;
        const padLen = numStr.length;
        const template = sample.replace(/-(\d{2,4})\.(jpe?g|png|webp|gif)(\?|$)/i, `-{N}.${ext.toLowerCase()}`);
        const totalFromTitle = parseInt(pageTitle.match(/(\d+)\s*P\b/i)?.[1] ?? '0', 10);
        const total = cfg.forceTotal && cfg.forceTotal > 0
          ? cfg.forceTotal
          : (totalFromTitle > 0 ? totalFromTitle : bestList.length);
        if (total > bestList.length) {
          inferred = true;
          allUrls = [];
          for (let i = 1; i <= total; i++) {
            allUrls.push(template.replace('{N}', String(i).padStart(padLen, '0')));
          }
        }
      }

      console.log(`[knit] ${articleUrl} title="${pageTitle.slice(0, 60)}" found=${bestList.length} ${inferred ? `inferred=${allUrls.length}` : 'no-inference'}`);

      allUrls.forEach((imgUrl, i) => {
        const externalId = createHash('sha256').update(imgUrl).digest('hex').slice(0, 40);
        out.push({
          url: imgUrl,
          externalId,
          title: `${galleryName} · 图 ${i + 1}`,
          text: [galleryName, `来自：${articleUrl}`].filter(Boolean).join('\n'),
          mediaUrls: [imgUrl],
          skipSimhash: true,
          extra: {
            sourcePage: articleUrl,
            galleryDir: bestDir,
            imageIndex: i + 1,
            totalInGallery: allUrls.length,
            inferred,
          },
        });
      });
    }

    // If we couldn't fetch any URL successfully and the failures look like
    // CF rejecting our session, flag credentials as expired.
    if (out.length === 0 && attempted > 0 && authRejects >= attempted) {
      throw new AdapterAuthError(
        403,
        cookie ? 'cf_clearance rejected — cookie likely expired' : 'no cookie configured',
      );
    }

    return out;
  },
};
