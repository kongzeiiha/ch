import axios from 'axios';
import sharp from 'sharp';

export interface Candidate {
  url: string;
  buffer: Buffer;
  width: number;
  height: number;
  score: number;
  format: string;
}

/**
 * The source row's platform decides which anti-hotlink headers to use.
 *   - 2ksg: pic.ylimg.com requires Referer + browser UA, otherwise empty body
 *   - knit: xx.knit.bid requires cf_clearance Cookie, otherwise 403
 *   - rss / html / others: plain UA is enough
 */
export interface SourceHeaderHint {
  platform?: string;
  config?: Record<string, unknown>;
}

const MAX_DOWNLOAD = 6 * 1024 * 1024; // 6 MB
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

function headersFor(hint?: SourceHeaderHint): Record<string, string> {
  const cfg = hint?.config ?? {};
  const platform = hint?.platform ?? '';
  if (platform === '2ksg') {
    return {
      'User-Agent': BROWSER_UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': (cfg.referer as string) || 'https://uib.2ksg.com/',
    };
  }
  if (platform === 'knit') {
    return {
      'User-Agent': (cfg.userAgent as string) || BROWSER_UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://xx.knit.bid/',
      ...(cfg.cookie ? { Cookie: cfg.cookie as string } : {}),
    };
  }
  if (platform === 'x') {
    return {
      'User-Agent': (cfg.userAgent as string) || BROWSER_UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://x.com/',
      ...(cfg.cookie ? { Cookie: cfg.cookie as string } : {}),
    };
  }
  return { 'User-Agent': 'ch-agents/0.1 (+cover)' };
}

export async function scoreOne(url: string, hint?: SourceHeaderHint): Promise<Candidate | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      maxContentLength: MAX_DOWNLOAD,
      validateStatus: (s) => s < 400,
      headers: headersFor(hint),
    });
    const buffer = Buffer.from(res.data);
    if (!buffer.length) return null; // hotlink-protected: 200 OK, empty body
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height || !meta.format) return null;

    // Skip obvious non-covers: tiny tracking pixels, ads, icons.
    if (meta.width < 400 || meta.height < 260) return null;

    const aspect = meta.width / meta.height;
    const aspectPenalty = aspect > 3 || aspect < 0.5 ? 0.25 : 1;
    const score = meta.width * meta.height * aspectPenalty;

    return { url, buffer, width: meta.width, height: meta.height, score, format: meta.format };
  } catch {
    return null;
  }
}

export async function pickBest(urls: string[], hint?: SourceHeaderHint): Promise<Candidate | null> {
  const top = await pickTopN(urls, 1, hint);
  return top[0] ?? null;
}

/**
 * Download every URL (capped), score by resolution + aspect, return the top N
 * candidates sorted best-first. Callers can use [0] as the cover and the rest
 * as a gallery.
 */
export async function pickTopN(urls: string[], n: number, hint?: SourceHeaderHint): Promise<Candidate[]> {
  if (urls.length === 0) return [];
  const capped = urls.slice(0, 20);
  const scored = await Promise.all(capped.map((u) => scoreOne(u, hint)));
  const valid = scored.filter((c): c is Candidate => c !== null);
  valid.sort((a, b) => b.score - a.score);
  return valid.slice(0, n);
}
