import axios from 'axios';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';

/**
 * Bluesky AT Protocol adapter — public XRPC, no auth required.
 *
 * Two modes via config.mode:
 *   - 'author': pull a specific user's recent posts
 *               GET /xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>
 *   - 'search': search posts by keyword or hashtag
 *               GET /xrpc/app.bsky.feed.searchPosts?q=<query>
 *
 * Posts may carry up to 4 images via `embed.images[]`. Each image has both
 * a `thumb` (300px max) and `fullsize` (~2000px) URL on bsky.social CDN.
 */

interface Config {
  mode?: 'author' | 'search';
  actor?: string;   // mode=author: 'pfrazee.com' or 'handle.bsky.social'
  query?: string;   // mode=search: '#photography' or 'sunset'
  limit?: number;   // 1..100
}

const PUBLIC_API = 'https://public.api.bsky.app';
const http = axios.create({ timeout: 20_000, validateStatus: () => true });

export const blueskyAdapter: SourceAdapter = {
  platform: 'bluesky',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    const mode = cfg.mode ?? 'author';
    const limit = Math.min(Math.max(Number(cfg.limit ?? 25), 1), 100);

    let endpoint: string;
    if (mode === 'author') {
      const actor = (cfg.actor ?? '').trim().replace(/^@/, '');
      if (!actor) return [];
      endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${limit}`;
    } else {
      const q = (cfg.query ?? '').trim();
      if (!q) return [];
      endpoint = `${PUBLIC_API}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${limit}`;
    }

    let body: any;
    try {
      const res = await http.get<any>(endpoint, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        throw new AdapterAuthError(res.status, 'bluesky public API unexpectedly rejected request');
      }
      if (res.status !== 200) {
        console.warn(`[bluesky] ${endpoint} http=${res.status}`);
        return [];
      }
      body = res.data;
    } catch (e: any) {
      if (e instanceof AdapterAuthError) throw e;
      console.warn(`[bluesky] fail: ${e?.message}`);
      return [];
    }

    // Both endpoints return slightly different shapes. Author feed wraps each
    // post in { post: ..., reason: ... }; search returns posts at top level.
    const posts: any[] = mode === 'author'
      ? (body?.feed ?? []).map((f: any) => f.post).filter(Boolean)
      : (body?.posts ?? []);

    const out: RawCandidate[] = [];
    for (const post of posts) {
      const text = String(post?.record?.text ?? '');
      const handle = String(post?.author?.handle ?? '');
      const cid = String(post?.cid ?? '');
      const uri = String(post?.uri ?? '');
      if (!cid || !handle) continue;

      const mediaUrls = extractMedia(post);
      if (mediaUrls.length === 0) continue;

      // AT URI is at://did:plc:.../app.bsky.feed.post/<rkey>
      const rkey = uri.split('/').pop() ?? cid;
      const webUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;

      out.push({
        url: webUrl,
        externalId: `bsky_${cid}`,
        title: text.slice(0, 100) || `@${handle} post`,
        text: [text, `@${handle}`].filter(Boolean).join('\n'),
        mediaUrls,
        skipSimhash: true,
        publishedAt: post?.record?.createdAt ? new Date(post.record.createdAt) : undefined,
        extra: {
          handle,
          posted: post?.record?.createdAt,
          likes: post?.likeCount,
          reposts: post?.repostCount,
          replies: post?.replyCount,
        },
      });
    }
    return out;
  },
};

function extractMedia(post: any): string[] {
  const urls: string[] = [];
  const embed = post?.embed;
  if (!embed) return urls;

  // 1. Plain image embed: app.bsky.embed.images#view
  for (const img of (embed.images ?? [])) {
    const u = img?.fullsize || img?.thumb;
    if (u) urls.push(u);
  }

  // 2. Quote-with-media: app.bsky.embed.recordWithMedia#view
  //    media is itself an embed (typically images).
  for (const img of (embed.media?.images ?? [])) {
    const u = img?.fullsize || img?.thumb;
    if (u) urls.push(u);
  }

  return urls;
}
