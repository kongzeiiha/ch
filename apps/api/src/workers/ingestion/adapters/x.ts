import axios from 'axios';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';
import { resolveAuth } from './auth.js';

/**
 * X (Twitter) adapter — replays the public web client's GraphQL calls using
 * the logged-in session's cookie. No OAuth, no paid API.
 *
 * Two modes via config.mode:
 *   - 'user':   pull a screen_name's recent tweets
 *               UserByScreenName → UserTweets
 *   - 'search': search top tweets matching a query
 *               SearchTimeline (product=Latest)
 *
 * Auth is the user's browser cookie. CSRF token is the `ct0` cookie value;
 * if csrfToken isn't passed explicitly, we extract it from the cookie string.
 *
 * X regenerates the GraphQL operation hashes (queryId) when their JS bundle
 * ships. We hardcode known-working defaults; a user can override them via
 * config.opIds when X breaks them, by copying the new hash from any
 * x.com/i/api/graphql/<HASH>/UserTweets request in DevTools Network.
 *
 * The "features" / "fieldToggles" objects are required by X's GraphQL and
 * also drift over time; we ship a snapshot known to work and allow override.
 */

interface Config {
  mode?: 'user' | 'search';
  screenName?: string;       // mode=user: 'natgeo' (no @)
  query?: string;            // mode=search: 'sunset OR aurora min_faves:50'
  cookie?: string;           // full Cookie: header
  csrfToken?: string;        // auto-derived from cookie's ct0 if not set
  bearerToken?: string;      // override; defaults to public web bearer
  userAgent?: string;        // matching UA
  limit?: number;            // 1..100
  /** Drop retweets from the result. Walker finds both the RT wrapper and the
   *  original tweet inside `legacy.retweeted_status_result`, so leaving RTs
   *  in produces 2 raw_items pointing to the same image. Default true. */
  skipRetweets?: boolean;
  opIds?: Partial<typeof DEFAULT_OP_IDS>;
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
}

// Public web bearer — hardcoded in twitter.com's JS bundle, well-known.
const PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Operation hashes captured from twitter.com's JS bundle. These rotate when
// X ships a new build; if you start seeing 404s, copy the new hash from
// DevTools and override via config.opIds.
const DEFAULT_OP_IDS = {
  UserByScreenName: 'G3KGOASz96M-Qu0nwmGXNg',
  UserTweets: 'V7H0Ap3_Hh2FyS75OCDO3Q',
  SearchTimeline: 'flaR-PUMshxFWZWPNpq4Zw',
};

const DEFAULT_FEATURES = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const DEFAULT_FIELD_TOGGLES = {
  withArticlePlainText: false,
};

const http = axios.create({
  timeout: 25_000,
  validateStatus: () => true,
  // X graphql endpoints are picky about gzip; let axios handle it.
});

export const xAdapter: SourceAdapter = {
  platform: 'x',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const cfg = source.config as Config;
    // Resolve auth from the credential pool first; fall back to inline config.
    const auth = await resolveAuth(source);
    const cookie = auth.cookie;
    if (!cookie) {
      throw new AdapterAuthError(401, 'X adapter needs cookie (set credential or config.cookie)');
    }
    const csrf = (cfg.csrfToken || extractCt0(cookie) || '').trim();
    if (!csrf) {
      throw new AdapterAuthError(401, 'X adapter could not derive csrf from cookie (missing ct0)');
    }

    const headers = {
      authorization: `Bearer ${cfg.bearerToken || PUBLIC_BEARER}`,
      'x-csrf-token': csrf,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
      'content-type': 'application/json',
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': auth.userAgent || cfg.userAgent || BROWSER_UA,
      origin: 'https://x.com',
      referer: 'https://x.com/',
      cookie,
    };

    const opIds = { ...DEFAULT_OP_IDS, ...(cfg.opIds || {}) };
    const features = { ...DEFAULT_FEATURES, ...(cfg.features || {}) };
    const fieldToggles = { ...DEFAULT_FIELD_TOGGLES, ...(cfg.fieldToggles || {}) };
    const limit = Math.min(Math.max(Number(cfg.limit ?? 40), 1), 100);
    const mode = cfg.mode ?? 'user';

    let tweets: any[] = [];

    if (mode === 'user') {
      const screen = (cfg.screenName ?? '').trim().replace(/^@/, '');
      if (!screen) return [];
      // Step 1: resolve handle → user rest_id
      const userId = await resolveUserId(screen, opIds.UserByScreenName, headers, features, fieldToggles);
      if (!userId) {
        console.warn(`[x] could not resolve @${screen} — bad handle or auth failed`);
        return [];
      }
      tweets = await fetchUserTweets(userId, limit, opIds.UserTweets, headers, features, fieldToggles);
    } else {
      const q = (cfg.query ?? '').trim();
      if (!q) return [];
      tweets = await fetchSearch(q, limit, opIds.SearchTimeline, headers, features, fieldToggles);
    }

    const out: RawCandidate[] = [];
    const skipRetweets = cfg.skipRetweets !== false; // default true
    for (const t of tweets) {
      const cand = tweetToCandidate(t, { skipRetweets });
      if (cand) out.push(cand);
    }
    return out;
  },
};

// ── GraphQL endpoints ────────────────────────────────────────────────────

async function resolveUserId(
  screenName: string,
  opId: string,
  headers: Record<string, string>,
  features: Record<string, boolean>,
  fieldToggles: Record<string, boolean>,
): Promise<string | null> {
  const variables = { screen_name: screenName };
  const url = buildUrl('UserByScreenName', opId, variables, features, fieldToggles);
  const res = await http.get<any>(url, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new AdapterAuthError(res.status, 'X rejected cookie/csrf — session expired or invalid');
  }
  if (res.status === 429) {
    throw new AdapterAuthError(429, 'X rate-limited this account — slow down or rotate session');
  }
  // 404 / 410 means the GraphQL operation hash no longer exists — X shipped
  // a new JS bundle. Surface as auth-fail so the workbench banner kicks in.
  if (res.status === 404 || res.status === 410) {
    throw new AdapterAuthError(
      res.status,
      `X returned ${res.status} for UserByScreenName — opId "${opId}" likely outdated`,
    );
  }
  if (res.status !== 200) {
    console.warn(`[x] UserByScreenName http=${res.status}`);
    return null;
  }
  // X returns 200 with an `errors` array when the GraphQL is malformed (e.g.
  // missing required variable, invalid feature flag). Don't silently return.
  if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
    const msg = res.data.errors[0]?.message || 'unknown GraphQL error';
    throw new AdapterAuthError(
      400,
      `X GraphQL rejected UserByScreenName: ${msg.slice(0, 120)}`,
    );
  }
  return res.data?.data?.user?.result?.rest_id ?? null;
}

async function fetchUserTweets(
  userId: string,
  count: number,
  opId: string,
  headers: Record<string, string>,
  features: Record<string, boolean>,
  fieldToggles: Record<string, boolean>,
): Promise<any[]> {
  const variables = {
    userId,
    count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: true,
  };
  const url = buildUrl('UserTweets', opId, variables, features, fieldToggles);
  const res = await http.get<any>(url, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new AdapterAuthError(res.status, 'X rejected cookie/csrf during UserTweets');
  }
  if (res.status === 429) {
    throw new AdapterAuthError(429, 'X rate-limited this account — slow down or rotate session');
  }
  if (res.status === 404 || res.status === 410) {
    throw new AdapterAuthError(res.status, `X returned ${res.status} for UserTweets — opId "${opId}" likely outdated`);
  }
  if (res.status !== 200) {
    console.warn(`[x] UserTweets http=${res.status}`);
    return [];
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
    const msg = res.data.errors[0]?.message || 'unknown GraphQL error';
    throw new AdapterAuthError(400, `X GraphQL rejected UserTweets: ${msg.slice(0, 120)}`);
  }
  return extractTweetsFromTimeline(res.data);
}

async function fetchSearch(
  query: string,
  count: number,
  opId: string,
  headers: Record<string, string>,
  features: Record<string, boolean>,
  fieldToggles: Record<string, boolean>,
): Promise<any[]> {
  const variables = {
    rawQuery: query,
    count,
    querySource: 'typed_query',
    product: 'Latest',
  };
  const url = buildUrl('SearchTimeline', opId, variables, features, fieldToggles);
  const res = await http.get<any>(url, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new AdapterAuthError(res.status, 'X rejected cookie/csrf during SearchTimeline');
  }
  if (res.status === 429) {
    throw new AdapterAuthError(429, 'X rate-limited this account — slow down or rotate session');
  }
  if (res.status === 404 || res.status === 410) {
    throw new AdapterAuthError(res.status, `X returned ${res.status} for SearchTimeline — opId "${opId}" likely outdated`);
  }
  if (res.status !== 200) {
    console.warn(`[x] SearchTimeline http=${res.status}`);
    return [];
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
    const msg = res.data.errors[0]?.message || 'unknown GraphQL error';
    throw new AdapterAuthError(400, `X GraphQL rejected SearchTimeline: ${msg.slice(0, 120)}`);
  }
  return extractTweetsFromTimeline(res.data);
}

function buildUrl(
  op: string,
  opId: string,
  variables: unknown,
  features: Record<string, boolean>,
  fieldToggles: Record<string, boolean>,
): string {
  const params = new URLSearchParams();
  params.set('variables', JSON.stringify(variables));
  params.set('features', JSON.stringify(features));
  params.set('fieldToggles', JSON.stringify(fieldToggles));
  return `https://x.com/i/api/graphql/${opId}/${op}?${params.toString()}`;
}

// ── Timeline tree walker ─────────────────────────────────────────────────

/**
 * X's GraphQL timeline response is deeply nested:
 *   data.user.result.timeline_v2.timeline.instructions[]
 *     - { type: 'TimelineAddEntries', entries: [...] }
 *   each entry: content.itemContent.tweet_results.result
 *
 * Search response is similar but rooted at search_by_raw_query.
 *
 * We just walk the whole tree and collect any object with __typename === 'Tweet'.
 */
function extractTweetsFromTimeline(json: any): any[] {
  const out: any[] = [];
  walk(json, (node) => {
    if (!node || typeof node !== 'object') return;
    if ((node.__typename === 'Tweet' || node.typename === 'Tweet') && node.legacy) {
      out.push(node);
    }
    // TweetWithVisibilityResults wraps a Tweet at .tweet
    if (node.__typename === 'TweetWithVisibilityResults' && node.tweet?.legacy) {
      out.push(node.tweet);
    }
  });
  return out;
}

function walk(node: any, visit: (n: any) => void): void {
  if (!node) return;
  visit(node);
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
  } else if (typeof node === 'object') {
    for (const k of Object.keys(node)) walk(node[k], visit);
  }
}

// ── Tweet → RawCandidate ─────────────────────────────────────────────────

function tweetToCandidate(t: any, opts: { skipRetweets?: boolean } = {}): RawCandidate | null {
  const id = t?.rest_id || t?.legacy?.id_str;
  const legacy = t?.legacy;
  if (!id || !legacy) return null;

  // Skip RT wrappers — the walker also finds the original tweet inside
  // `retweeted_status_result.result`, so keeping the wrapper just produces
  // a duplicate raw_item pointing to the same media.
  if (opts.skipRetweets !== false && legacy.retweeted_status_result) return null;

  const author = t?.core?.user_results?.result?.legacy?.screen_name
              || t?.core?.user_results?.result?.core?.screen_name
              || 'unknown';
  const fullText = legacy.full_text ?? '';

  // Media in legacy.entities.media[] / legacy.extended_entities.media[]
  // (extended_entities has higher-fidelity URLs and includes all 4 images)
  const mediaList = (legacy.extended_entities?.media || legacy.entities?.media || []) as any[];
  const mediaUrls: string[] = [];
  const videoUrls: string[] = [];
  for (const m of mediaList) {
    if (m?.type === 'photo' && m.media_url_https) {
      // Append :large for highest-res photos
      const u = m.media_url_https.endsWith('.jpg') || m.media_url_https.endsWith('.png')
        ? `${m.media_url_https}:large`
        : m.media_url_https;
      mediaUrls.push(u);
    } else if ((m?.type === 'video' || m?.type === 'animated_gif') && m.media_url_https) {
      // For videos/GIFs we're an IMAGE pipeline — store the poster frame
      // (media_url_https is always a static jpg) and stash the highest-bitrate
      // mp4 URL in `extra` so consumers who care about video can find it.
      mediaUrls.push(m.media_url_https);
      const variants = (m.video_info?.variants ?? []).filter((v: any) => v.content_type === 'video/mp4');
      variants.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      if (variants[0]?.url) videoUrls.push(variants[0].url);
    }
  }

  if (mediaUrls.length === 0) return null; // skip text-only tweets

  const webUrl = `https://x.com/${author}/status/${id}`;
  return {
    url: webUrl,
    externalId: `x_${id}`,
    title: fullText.slice(0, 100) || `@${author} tweet`,
    text: [fullText, `@${author}`].filter(Boolean).join('\n'),
    mediaUrls,
    skipSimhash: true,
    publishedAt: legacy.created_at ? new Date(legacy.created_at) : undefined,
    extra: {
      author,
      tweetId: id,
      retweets: legacy.retweet_count,
      likes: legacy.favorite_count,
      replies: legacy.reply_count,
      ...(videoUrls.length ? { videoUrls } : {}),
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractCt0(cookie: string): string | null {
  const m = /(?:^|;\s*)ct0=([^;]+)/.exec(cookie);
  return m ? m[1] : null;
}
