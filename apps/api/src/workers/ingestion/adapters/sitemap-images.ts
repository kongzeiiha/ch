import axios from 'axios';
import { createHash } from 'node:crypto';
import type { SourceAdapter, SourceRow, RawCandidate } from './types.js';

/**
 * Standard image-sitemap adapter — parses the `<image:image>` extension
 * (https://www.google.com/schemas/sitemap-image/0.9) used by SEO plugins
 * (Yoast, Rank Math, AIOSEO, etc).
 *
 * Schema:
 *   <urlset xmlns:image="http://www.google.com/schemas/sitemap-image/0.9">
 *     <url>
 *       <loc>https://example.com/some-article</loc>
 *       <image:image>
 *         <image:loc>https://cdn.example.com/img1.jpg</image:loc>
 *         <image:title>Optional alt-text</image:title>
 *         <image:caption>Optional caption</image:caption>
 *       </image:image>
 *       ... (multiple image:image blocks per page allowed)
 *     </url>
 *     ...
 *   </urlset>
 *
 * Also supports sitemap-index files (the parent <sitemapindex> with multiple
 * <sitemap><loc> children) — recursively fetches each child sitemap.
 *
 * Each found image becomes 1 RawCandidate (per-image mode). Capped at
 * config.limit images per run.
 */

interface Config {
  sitemapUrl?: string;
  limit?: number;       // max images to ingest per run, default 200
  pagePattern?: string; // optional regex on <loc> URL to filter pages
}

const http = axios.create({
  timeout: 30_000,
  validateStatus: () => true,
  // Sitemaps can be large; bump max body to 10MB
  maxContentLength: 10 * 1024 * 1024,
});

const UA = 'Mozilla/5.0 (compatible; ch-agents-sitemap/0.1)';

export const sitemapImagesAdapter: SourceAdapter = {
  platform: 'sitemap-images',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    if (!cfg.sitemapUrl) return [];
    const limit = Math.min(Math.max(Number(cfg.limit ?? 200), 1), 5000);
    let pageRe: RegExp | undefined;
    if (cfg.pagePattern) {
      try { pageRe = new RegExp(cfg.pagePattern); } catch { /* ignore bad regex */ }
    }

    const visited = new Set<string>();
    const out: RawCandidate[] = [];

    async function processUrl(url: string, depth = 0): Promise<void> {
      if (depth > 2) return; // safety: index → child → grandchild only
      if (visited.has(url) || out.length >= limit) return;
      visited.add(url);

      let xml: string;
      try {
        const res = await http.get<string>(url, {
          responseType: 'text',
          headers: { 'User-Agent': UA, 'Accept': 'application/xml,text/xml,*/*' },
        });
        if (res.status !== 200) {
          console.warn(`[sitemap-images] ${url} http=${res.status}`);
          return;
        }
        xml = String(res.data || '');
      } catch (e: any) {
        console.warn(`[sitemap-images] ${url} fail: ${e?.message}`);
        return;
      }

      // Detect sitemap-index and recurse
      if (/<sitemapindex[\s>]/i.test(xml)) {
        const childLocs = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)]
          .map((m) => m[1].trim())
          .filter(Boolean);
        for (const child of childLocs) {
          if (out.length >= limit) break;
          await processUrl(child, depth + 1);
        }
        return;
      }

      // Parse <url> blocks
      const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
      for (const block of urlBlocks) {
        if (out.length >= limit) break;
        const pageLoc = decodeXml(block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? '').trim();
        if (!pageLoc) continue;
        if (pageRe && !pageRe.test(pageLoc)) continue;

        const imgRe = /<image:image>([\s\S]*?)<\/image:image>/g;
        let m: RegExpExecArray | null;
        let i = 0;
        while ((m = imgRe.exec(block))) {
          if (out.length >= limit) break;
          const inner = m[1];
          const imgLoc = decodeXml(inner.match(/<image:loc>([^<]+)<\/image:loc>/)?.[1] ?? '').trim();
          if (!imgLoc || !/^https?:\/\//i.test(imgLoc)) continue;
          const title = decodeXml(inner.match(/<image:title>([^<]+)<\/image:title>/)?.[1] ?? '').trim();
          const caption = decodeXml(inner.match(/<image:caption>([^<]+)<\/image:caption>/)?.[1] ?? '').trim();
          i++;

          const externalId = createHash('sha256').update(imgLoc).digest('hex').slice(0, 40);
          const displayTitle = title || caption || `${pageLoc} · 图 ${i}`;
          out.push({
            url: imgLoc,
            externalId: `sitemap_${externalId}`,
            title: displayTitle,
            text: [displayTitle, caption, `来自:${pageLoc}`].filter(Boolean).join('\n'),
            mediaUrls: [imgLoc],
            skipSimhash: true,
            extra: { sourcePage: pageLoc, imageIndex: i },
          });
        }
      }
    }

    await processUrl(cfg.sitemapUrl, 0);
    console.log(`[sitemap-images] ${cfg.sitemapUrl} visited=${visited.size} images=${out.length}`);
    return out;
  },
};

/** Minimal XML entity decoder for &amp; &lt; &gt; &quot; &apos; and CDATA. */
function decodeXml(s: string): string {
  let v = s;
  // Strip CDATA wrapper if present
  v = v.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  v = v.replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  return v;
}
