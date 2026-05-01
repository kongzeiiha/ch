import axios from 'axios';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';

/**
 * Reddit adapter — uses the public `.json` endpoint that every listing has
 * (e.g. https://www.reddit.com/r/EarthPorn/top.json?t=day&limit=25).
 *
 * No OAuth required for public subreddits. Reddit DOES enforce a rate limit
 * keyed on User-Agent though — set a unique UA in config or use the default.
 *
 * Image extraction handles three post shapes:
 *   - direct image post:   data.url ends in .jpg/.png/.webp/.gif
 *   - rich preview:        data.preview.images[].source.url (HTML entities decoded)
 *   - gallery post:        data.is_gallery + data.media_metadata[*].s.u
 */

interface Config {
  /** Preferred — one source per subreddit (batch-import model). */
  subreddit?: string;
  /** Legacy — multiple subs per source. Still works, kept for backward compat. */
  subreddits?: string[];
  sort?: 'hot' | 'new' | 'top' | 'rising' | 'controversial';
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'; // only used when sort=top|controversial
  limit?: number;                                        // per subreddit, 1..100
  userAgent?: string;
}

const DEFAULT_UA = 'ch-agents/0.1 (+content-pipeline)';

const http = axios.create({ timeout: 20_000, validateStatus: () => true });

export const redditAdapter: SourceAdapter = {
  platform: 'reddit',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    // Prefer the new singular `subreddit` field; fall back to legacy array.
    const rawSubs = cfg.subreddit ? [cfg.subreddit] : (cfg.subreddits ?? []);
    const subs = rawSubs
      .map((s) => String(s || '').replace(/^\/?r\//i, '').replace(/^\/+|\/+$/g, '').trim())
      .filter(Boolean);
    if (!subs.length) return [];

    const sort = cfg.sort ?? 'top';
    const time = cfg.time ?? 'day';
    const limit = Math.min(Math.max(Number(cfg.limit ?? 25), 1), 100);
    const ua = cfg.userAgent || DEFAULT_UA;

    const out: RawCandidate[] = [];
    let attempted = 0;
    let blocked = 0;

    for (const sub of subs) {
      attempted++;
      const tParam = (sort === 'top' || sort === 'controversial') ? `&t=${time}` : '';
      const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}${tParam}`;

      let body: any;
      try {
        const res = await http.get<any>(url, {
          headers: { 'User-Agent': ua, 'Accept': 'application/json' },
        });
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          blocked++;
          console.warn(`[reddit] r/${sub} blocked: http=${res.status}`);
          continue;
        }
        if (res.status !== 200) {
          console.warn(`[reddit] r/${sub} http=${res.status}`);
          continue;
        }
        body = res.data;
      } catch (e: any) {
        console.warn(`[reddit] r/${sub} fail: ${e?.message}`);
        continue;
      }

      const children = body?.data?.children ?? [];
      for (const c of children) {
        const d = c?.data;
        if (!d || typeof d.id !== 'string') continue;

        const mediaUrls = extractImages(d);
        if (mediaUrls.length === 0) continue;

        const title = String(d.title ?? '');
        const permalink = `https://www.reddit.com${d.permalink}`;

        out.push({
          url: permalink,
          externalId: `reddit_${d.id}`,
          title,
          text: [title, (d.selftext ?? '').slice(0, 300), `r/${sub} · u/${d.author}`].filter(Boolean).join('\n'),
          mediaUrls,
          skipSimhash: true,
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : undefined,
          extra: {
            subreddit: sub,
            score: d.score,
            comments: d.num_comments,
            author: d.author,
            over18: !!d.over_18,
          },
        });
      }
    }

    // If every subreddit was rate-limited / blocked, surface as auth-fail so
    // the workbench banner kicks in ("rotate your User-Agent").
    if (out.length === 0 && blocked === attempted && attempted > 0) {
      throw new AdapterAuthError(
        429,
        'reddit blocked every request — rate limited or UA banned',
      );
    }
    return out;
  },
};

function extractImages(post: any): string[] {
  const urls = new Set<string>();
  const decode = (s: string) => s.replace(/&amp;/g, '&');

  // 1. Direct image URL (post_hint='image' or filename suffix)
  if (typeof post.url === 'string' && /\.(jpe?g|png|webp|gif)(?:\?|$)/i.test(post.url)) {
    urls.add(post.url);
  }

  // 2. Reddit-hosted preview (highest-res "source")
  for (const im of (post.preview?.images ?? [])) {
    if (im?.source?.url) urls.add(decode(im.source.url));
  }

  // 3. Gallery post (multi-image)
  if (post.is_gallery && post.media_metadata) {
    for (const k of Object.keys(post.media_metadata)) {
      const m = post.media_metadata[k];
      if (m?.s?.u) urls.add(decode(m.s.u));
      else if (m?.s?.gif) urls.add(decode(m.s.gif));
    }
  }

  return [...urls];
}
