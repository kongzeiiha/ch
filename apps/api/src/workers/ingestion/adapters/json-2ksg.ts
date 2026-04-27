import axios from 'axios';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';

/**
 * Adapter for the 2ksg / aizuyun / dvandme image-gallery family of mirror
 * sites. They all share the same backend:
 *
 *   GET https://{host}/data/img/detail/{bucket}/{id}.json?cts={cacheBust}
 *   Headers: token, Referer
 *
 * Response is a JSON envelope wrapped in junk text (anti-leech) where every
 * user-visible field is hex-encoded with the scheme:
 *
 *   "xo<hex1>o<hex2>o<hex3>..."   →   String.fromCharCode(0xhex1, 0xhex2, ...)
 *
 * The actual gallery images live inside the decoded `data.content` field as
 * HTML (a sequence of <img src=...> nodes interspersed with sponsor links).
 *
 * `data.list` carries related-gallery IDs, which we optionally BFS-crawl when
 * `crawlList: true`, capped by `maxIds`.
 */

interface Config {
  ids?: string[];                  // explicit list of detail IDs to ingest
  bucket?: string;                 // path segment after /detail/, e.g. "5"
  host?: string;                   // e.g. "uib.2ksg.com"
  token?: string;                  // 'token' header value
  referer?: string;                // Referer header
  crawlList?: boolean;             // also follow data.list[].id
  maxIds?: number;                 // cap on total ids to fetch
}

const DEFAULT_HOST = 'uib.2ksg.com';
const DEFAULT_BUCKET = '5';
const DEFAULT_REFERER = 'https://uib.2ksg.com/app/';
const DEFAULT_MAX_IDS = 30;

const http = axios.create({
  timeout: 20_000,
  // Don't auto-decompress error pages — accept any status to inspect.
  validateStatus: () => true,
});

export const json2ksgAdapter: SourceAdapter = {
  platform: '2ksg',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    const host = cfg.host || DEFAULT_HOST;
    const bucket = cfg.bucket || DEFAULT_BUCKET;
    const referer = cfg.referer || DEFAULT_REFERER;
    const token = cfg.token || '';
    const crawlList = cfg.crawlList === true;
    const maxIds = Math.max(1, Math.min(200, Number(cfg.maxIds ?? DEFAULT_MAX_IDS)));

    const seedIds = Array.isArray(cfg.ids) ? cfg.ids.map(String).filter(Boolean) : [];
    if (!seedIds.length) {
      console.warn(`[2ksg] source ${source.id} has no ids in config`);
      return [];
    }

    const queue = [...seedIds];
    const visited = new Set<string>();
    const out: RawCandidate[] = [];
    // Bucket isn't derivable from the SPA URL — it's assigned per-id by the
    // backend. Try the configured bucket first, then fall back to 0-9. Cache
    // every successful bucket so later ids in the same run skip the probe.
    const bucketCache = new Set<string>([bucket]);

    while (queue.length && visited.size < maxIds) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const json = await fetchDetail(id, host, bucketCache, referer, token);
      if (!json || json.err !== 0 || !json.data) {
        console.warn(`[2ksg] id=${id} not found in any bucket (err=${json?.err ?? 'http'})`);
        continue;
      }

      const data = json.data as any;
      const galleryName = decode(data.name) || `id-${id}`;
      const label = decode(data.label) || '';
      const cover = decode(data.pic) || decode(data.thumb) || '';
      const contentHtml = decode(data.content) || '';
      const detailPageUrl = `https://${host}/app/#/detail?mode=img&tid=&sid=&id=${id}`;

      const imgs = extractImages(contentHtml, cover);
      if (imgs.length === 0) {
        console.warn(`[2ksg] id=${id} no images`);
      }

      imgs.forEach((imgUrl, i) => {
        const externalId = createHash('sha256').update(`${id}|${imgUrl}`).digest('hex').slice(0, 40);
        out.push({
          url: imgUrl,
          externalId,
          title: `${galleryName} · 图 ${i + 1}`,
          text: [galleryName, label, `来源：${detailPageUrl}`].filter(Boolean).join('\n'),
          mediaUrls: [imgUrl],
          skipSimhash: true,
          extra: {
            sourcePage: detailPageUrl,
            galleryId: id,
            galleryName,
            label,
            imageIndex: i + 1,
            totalInGallery: imgs.length,
          },
        });
      });

      if (crawlList && Array.isArray(data.list)) {
        for (const item of data.list) {
          const nid = String(item?.id ?? '').trim();
          if (nid && !visited.has(nid) && !queue.includes(nid)) queue.push(nid);
        }
      }
    }

    console.log(`[2ksg] source=${source.id} visited=${visited.size} galleries images=${out.length}`);
    return out;
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

function cacheBust(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
}

/**
 * Fetch detail.json for a gallery id. Bucket is opaque — try the cached set
 * first (in insertion order), fall back to 0-9. Cache every successful bucket
 * so the rest of this ingest run skips probing.
 */
async function fetchDetail(
  id: string,
  host: string,
  bucketCache: Set<string>,
  referer: string,
  token: string,
): Promise<any | null> {
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': referer,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    ...(token ? { token } : {}),
  };

  // Try cached buckets first (most-recent successful one is most likely match
  // for the next id in the same source), then fall back to 0-9 in order.
  const tried = new Set<string>();
  const order = [...bucketCache, ...Array.from({ length: 10 }, (_, i) => String(i))];

  // Track suspicious response shapes across buckets:
  //  - 404 = "not in this bucket" (normal, keep probing)
  //  - 401/403 = token rejected (auth fail signal)
  //  - 200 with HTML body = upstream domain hijacked / replaced (the bf306848
  //    `uib.2ksg.com` symptom: every path returns a generic landing page)
  //  - 200 with valid JSON envelope but err≠0 = id genuinely missing
  let sawAuthReject = 0;
  let saw404 = 0;
  let sawHtml = 0;
  let sawValidJson = 0;

  for (const b of order) {
    if (tried.has(b)) continue;
    tried.add(b);
    const url = `https://${host}/data/img/detail/${b}/${id}.json?cts=${cacheBust()}`;
    try {
      const res = await http.get<string>(url, { responseType: 'text', headers });
      if (res.status === 401 || res.status === 403) { sawAuthReject++; continue; }
      if (res.status === 404) { saw404++; continue; }
      if (res.status !== 200) continue;
      const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      // Guard against upstream replacing JSON with HTML (e.g. mirror domain
      // taken over). We only consider it valid JSON if parseEnvelope returns
      // an object — anything else means we got an HTML landing page or junk.
      const parsed = parseEnvelope(body);
      const looksLikeHtml = /<!doctype\s+html|<html[\s>]/i.test(body.slice(0, 500));
      if (looksLikeHtml && !parsed) { sawHtml++; continue; }
      if (parsed) {
        sawValidJson++;
        if (parsed.err === 0 && parsed.data) {
          bucketCache.add(b);
          return parsed;
        }
      }
    } catch (e: any) {
      // network/timeout — try next bucket
      console.warn(`[2ksg] id=${id} bucket=${b} fail: ${e?.message}`);
    }
  }
  // No success across any bucket — figure out why and fail loudly.
  if (sawHtml > 0 && sawValidJson === 0) {
    // Every bucket returned HTML, never proper JSON → upstream changed.
    throw new AdapterAuthError(
      503,
      `host ${host} returned HTML on every bucket — mirror likely down or replaced`,
    );
  }
  if (sawAuthReject > 0 && saw404 === 0 && sawValidJson === 0) {
    throw new AdapterAuthError(403, 'token rejected on every bucket — token likely expired');
  }
  return null;
}

/** Strip junk wrapping the JSON envelope and parse. */
function parseEnvelope(raw: string): any | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

/**
 * Decode a value of the form `xo<hex1>o<hex2>...`. Each hex segment is a
 * char code (1-4 hex digits). Empty / falsy / non-encoded values pass through.
 */
export function decode(s: unknown): string {
  if (typeof s !== 'string' || !s) return '';
  if (!s.startsWith('xo')) return s;
  const parts = s.slice(2).split('o').filter(Boolean);
  let out = '';
  for (const hex of parts) {
    const n = parseInt(hex, 16);
    if (Number.isFinite(n) && n > 0) out += String.fromCharCode(n);
  }
  return out;
}

/** Pull every <img src> from the decoded content HTML, plus the cover. */
function extractImages(contentHtml: string, cover: string): string[] {
  const seen = new Set<string>();
  const push = (u: string) => {
    const t = (u || '').trim();
    if (!t) return;
    if (!/^https?:\/\//i.test(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
  };
  if (cover) push(cover);
  if (contentHtml) {
    try {
      const dom = new JSDOM(`<!doctype html><body>${contentHtml}</body>`);
      for (const img of Array.from(dom.window.document.querySelectorAll('img'))) {
        push(img.getAttribute('src') || img.getAttribute('data-src') || '');
      }
    } catch {
      // Fall back to regex if jsdom chokes.
      const re = /<img[^>]+src=["']([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(contentHtml)) !== null) push(m[1]);
    }
  }
  return [...seen];
}
