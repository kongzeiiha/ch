import axios from 'axios';
import { execute } from '@ch/db';
import { AdapterAuthError, type SourceAdapter, type SourceRow, type RawCandidate } from './types.js';
import { resolveAuth } from './auth.js';

// Tracks whether we've already logged the SearchTimeline → playwright
// fallback. The direct GraphQL path returns 404 for every search now (x has
// gated it behind x-client-transaction-id) so this fired on every keyword
// search → flooded the log. Switch to once-per-process to keep the signal
// visible without the noise.
let searchTimelineFallbackLogged = false;

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
// X rotates these GraphQL operation hashes every 2-4 weeks when they ship a
// new web bundle. When a route 404s, capture the fresh hash from DevTools
// (filter "graphql" in Network panel) and override via env vars:
//   X_OPID_USER_BY_SCREEN_NAME
//   X_OPID_USER_TWEETS
//   X_OPID_SEARCH_TIMELINE        (used by both tweet-search and user-discover)
const DEFAULT_OP_IDS = {
  UserByScreenName: process.env.X_OPID_USER_BY_SCREEN_NAME || 'G3KGOASz96M-Qu0nwmGXNg',
  UserTweets:       process.env.X_OPID_USER_TWEETS         || 'V7H0Ap3_Hh2FyS75OCDO3Q',
  SearchTimeline:   process.env.X_OPID_SEARCH_TIMELINE     || 'flaR-PUMshxFWZWPNpq4Zw',
  // 评论同步 worker 用,GraphQL TweetDetail / TweetResultByRestId 的 opId 同样
  // 会被 X 频繁轮换。挂 404 时从 DevTools 抓最新值放到 X_OPID_TWEET_DETAIL。
  TweetDetail:      process.env.X_OPID_TWEET_DETAIL        || 'xOhkmRac7eYpfWxAY3LMqQ',
};

// Synced from a live x.com SearchTimeline request — 2026-05-11.
// When X starts 404'ing again, re-capture from DevTools and replace this block.
// X validates this list exactly: extra / missing / mistyped keys all → 404.
const DEFAULT_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
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
      // Step 1: resolve handle → user rest_id (+ cache the upstream display name)
      const resolved = await resolveUserId(screen, opIds.UserByScreenName, headers, features, fieldToggles);
      if (!resolved?.userId) {
        console.warn(`[x] could not resolve @${screen} — bad handle or auth failed`);
        return [];
      }
      // Cache 「display name」+ 「avatar」 — the X profile "name" field
      // (e.g. 我在故宫胡吃海喝) and profile_image_url_https. Read path uses
      // COALESCE(display_name, name) and proxiedImage(avatar_url, sourceId)
      // so this is purely an upgrade in display.
      const dn = resolved.displayName?.trim().slice(0, 128) || null;
      const av = resolved.avatarUrl?.trim().slice(0, 512) || null;
      if (dn || av) {
        try {
          await execute(
            `UPDATE sources
               SET display_name = COALESCE($1, display_name),
                   avatar_url   = COALESCE($2, avatar_url)
             WHERE id = $3
               AND (
                 ($1 IS NOT NULL AND (display_name IS NULL OR display_name <> $1))
                 OR
                 ($2 IS NOT NULL AND (avatar_url   IS NULL OR avatar_url   <> $2))
               )`,
            [dn, av, source.id],
          );
        } catch (e: any) {
          console.warn(`[x] failed to cache profile meta for ${source.id}: ${e?.message ?? e}`);
        }
      }
      tweets = await fetchUserTweets(resolved.userId, limit, opIds.UserTweets, headers, features, fieldToggles);
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
): Promise<{ userId: string | null; displayName: string | null; avatarUrl: string | null }> {
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
    return { userId: null, displayName: null, avatarUrl: null };
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
  const u = res.data?.data?.user?.result;
  // Display name lives in legacy.name; core.name is the newer schema mirror.
  // Either is acceptable. The handle (urgseukekcbdnrb) lives in legacy.screen_name.
  const displayName = u?.legacy?.name ?? u?.core?.name ?? null;
  // Avatar:legacy.profile_image_url_https 是 _normal.jpg 小图;upscale 到
  // _400x400 拿到大图(替换 _normal 后 X CDN 自动返回更大尺寸)。
  const rawAvatar: string | null = u?.legacy?.profile_image_url_https
                              ?? u?.avatar?.image_url
                              ?? null;
  const avatarUrl = rawAvatar ? rawAvatar.replace(/_normal(\.\w+)$/, '_400x400$1') : null;
  return { userId: u?.rest_id ?? null, displayName, avatarUrl };
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
    withGrokTranslatedBio: true,
  };
  const opName = process.env.X_OP_SEARCH_TIMELINE || 'SearchTimeline';
  // SearchTimeline schema no longer accepts fieldToggles — pass empty so
  // buildUrl drops the param.
  const url = buildUrl(opName, opId, variables, features, {});
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
  // X's current SearchTimeline endpoint rejects requests that send an
  // unrecognized `fieldToggles` param → 404. Only attach it if there's
  // anything to send (UserByScreenName/UserTweets still expect it).
  if (fieldToggles && Object.keys(fieldToggles).length > 0) {
    params.set('fieldToggles', JSON.stringify(fieldToggles));
  }
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
/**
 * Discover X accounts by keyword. Uses SearchTimeline with `product: 'People'`
 * which returns user nodes instead of tweets. Caller passes a valid cookie
 * (either from credential pool or inline) — we don't reach into the DB here.
 *
 * Returns deduped, ranked-by-followers user summaries. Limit is hard-capped
 * at 50 (X's own page size for the People product).
 */
export interface XUserSummary {
  screen_name: string;
  name: string;
  description: string;
  followers_count: number;
  profile_image_url: string;
  verified: boolean;
}

/**
 * Browser-based fallback for keyword user discovery. X's SearchTimeline now
 * requires an `x-client-transaction-id` header signed by their obfuscated
 * client JS — direct axios calls can't reproduce it, so we drive a real
 * (headless) chromium to /search and intercept the GraphQL response.
 *
 * Cost: ~3-5s per call (browser launch + page load). Used only when the
 * direct path 404s.
 */
async function searchUsersByKeywordViaBrowser(opts: {
  cookie: string;
  userAgent?: string;
  query: string;
  count?: number;
}): Promise<XUserSummary[]> {
  // Lazy-import playwright-extra so cold starts that never call this don't
  // pay the import cost.
  const { chromium: chromiumExtra } = await import('playwright-extra');
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default();
  stealth.enabledEvasions.delete('iframe.contentWindow');
  stealth.enabledEvasions.delete('media.codecs');
  (chromiumExtra as any).use(stealth);

  const browser = await (chromiumExtra as any).launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: opts.userAgent || BROWSER_UA,
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
    });

    // Parse the "name=value; name=value" cookie string into Playwright's
    // setCookie format. Domain '.x.com' makes them visible to both x.com
    // and api.x.com.
    const cookieEntries: Array<{ name: string; value: string; domain: string; path: string }> = [];
    for (const part of opts.cookie.split(/;\s*/)) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name) continue;
      cookieEntries.push({ name, value, domain: '.x.com', path: '/' });
    }
    if (cookieEntries.length === 0) {
      throw new AdapterAuthError(401, 'cookie string parsed to empty — credential malformed');
    }
    await ctx.addCookies(cookieEntries);

    const page = await ctx.newPage();

    // Persistent response listener — collects every graphql payload that
    // contains User nodes. We don't lock onto a specific op name because X
    // has been migrating between SearchTimeline / UsersSearchTimeline / etc.
    //
    // Critical fix from the previous version: read the body INSIDE the
    // listener with a swallow-on-error try-catch. Reading res.json() can
    // race with page navigation; if it errors we just drop that one body.
    const capturedJsons: any[] = [];
    const opNamesSeen: string[] = [];
    const onResponse = async (res: any) => {
      const url = res.url();
      if (!url.includes('/i/api/graphql/')) return;
      if (res.status() !== 200) return;
      const m = url.match(/\/graphql\/[^/]+\/([^/?]+)/);
      const op = m?.[1] ?? '';
      if (op) opNamesSeen.push(op);
      try {
        const body = await res.text();   // text() is more forgiving than json()
        if (!body.includes('"__typename":"User"') && !body.includes('"user_results"')) return;
        const json = JSON.parse(body);
        capturedJsons.push(json);
      } catch { /* body read after page closed / non-JSON / etc — drop */ }
    };
    page.on('response', onResponse);

    // Helper: wait until at least one User-bearing payload arrives, polling
    // every 200ms (tighter than the old 500ms — catches X's burst pattern).
    const waitForUserPayload = async (ms: number) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline && capturedJsons.length === 0) {
        await page.waitForTimeout(200);
      }
    };

    let navError: any = null;
    try {
      // Step 1: warm up on x.com to let cookies + stealth fingerprint settle.
      // Without this X sometimes 302s the very first /search request to /login.
      // Tightened 30s → 8s — the warm-up just needs cookie injection +
      // a couple JS frames to run; full document load is wasteful and used to
      // push total runtime past the Next.js proxy's 30s default cutoff.
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(400);

      // Step 2: navigate to People search. 12s budget — enough for X's typical
      // 2-4s GraphQL response, with margin for slow networks.
      const url = `https://x.com/search?q=${encodeURIComponent(opts.query)}&src=typed_query&f=user`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => {});

      // Wait for first batch — most searches return in <3s.
      await waitForUserPayload(7_000);

      // Retry path: scroll once to trigger any deferred SearchTimeline that
      // X fires only after the search input gets focused / the results pane
      // mounts. Cheap; runs only if the first wait found nothing.
      if (capturedJsons.length === 0) {
        try {
          await page.evaluate(() => window.scrollBy(0, 600));
          await page.waitForTimeout(400);
        } catch { /* ignore */ }
        await waitForUserPayload(3_000);
      }
    } catch (e: any) {
      navError = e;
    } finally {
      page.off('response', onResponse);
    }

    if (capturedJsons.length === 0) {
      const opsList = Array.from(new Set(opNamesSeen)).slice(0, 8).join(', ') || 'none';
      let currentUrl = '?';
      let title = '?';
      try { currentUrl = page.url(); title = await page.title(); } catch { /* ignore */ }
      console.warn(`[x] playwright captured no User payload — ops seen: ${opsList} · page: ${currentUrl} · title="${title}"${navError ? ` · navErr: ${navError?.message ?? navError}` : ''}`);
      throw new AdapterAuthError(
        504,
        `X did not return user payload (ops seen: ${opsList}) — cookie may be expired or X redirected. Page now at: ${currentUrl}`,
      );
    }
    const captured = capturedJsons;
    console.info(`[x] playwright captured ${capturedJsons.length} payload(s); ops: ${Array.from(new Set(opNamesSeen)).join(', ')}`);

    // Reuse the same User-node walker as the direct path so result shape
    // stays identical.
    const users: any[] = [];
    walk(captured, (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.__typename === 'User' && (node.legacy || node.core)) users.push(node);
    });

    const tally = new Map<string, number>();
    const byHandle = new Map<string, XUserSummary>();
    const want = Math.min(Math.max(opts.count ?? 20, 1), 50);
    for (const u of users) {
      const screen: string = u.legacy?.screen_name || u.core?.screen_name || '';
      if (!screen) continue;
      const key = screen.toLowerCase();
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (!byHandle.has(key)) {
        byHandle.set(key, {
          screen_name: screen,
          name: u.legacy?.name || u.core?.name || '',
          description: u.legacy?.description || '',
          followers_count: Number(u.legacy?.followers_count ?? 0),
          profile_image_url: u.legacy?.profile_image_url_https || u.avatar?.image_url || '',
          verified: !!(u.legacy?.verified || u.is_blue_verified || u.verification?.verified),
        });
      }
    }
    const out = Array.from(byHandle.values());
    out.sort((a, b) => {
      const ca = tally.get(a.screen_name.toLowerCase()) ?? 0;
      const cb = tally.get(b.screen_name.toLowerCase()) ?? 0;
      if (cb !== ca) return cb - ca;
      return b.followers_count - a.followers_count;
    });
    return out.slice(0, want);
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
}

export async function searchUsersByKeyword(opts: {
  cookie: string;
  userAgent?: string;
  query: string;
  count?: number;
}): Promise<XUserSummary[]> {
  const csrf = (extractCt0(opts.cookie) || '').trim();
  if (!csrf) throw new AdapterAuthError(401, 'cookie missing ct0 — refresh the credential');

  const headers = {
    authorization: `Bearer ${PUBLIC_BEARER}`,
    'x-csrf-token': csrf,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': opts.userAgent || BROWSER_UA,
    origin: 'https://x.com',
    referer: 'https://x.com/',
    cookie: opts.cookie,
  };

  const count = Math.min(Math.max(opts.count ?? 20, 1), 50);
  // Uses DEFAULT_OP_IDS.SearchTimeline + X_OP_SEARCH_TIMELINE so both the
  // operation hash AND the operation name can be overridden from env (X has
  // shipped bundles using names like "SearchTimelineV2" / "UsersSearchTimeline").
  const searchOp = process.env.X_OP_SEARCH_TIMELINE || 'SearchTimeline';
  const searchOpId = DEFAULT_OP_IDS.SearchTimeline;

  // ── Strategy ────────────────────────────────────────────────────────────
  // Some X bundles serve user discovery via SearchTimeline(product:'People');
  // others have deprecated People entirely and only return tweets. We try
  // People first; if it 404s (or returns zero users) we fall back to a Latest
  // tweet search and harvest unique authors. Either way the caller gets a
  // ranked list of accounts matching the keyword.
  async function callTimeline(product: 'People' | 'Latest' | 'Top') {
    const variables = {
      rawQuery: opts.query,
      count,
      querySource: 'typed_query',
      product,
      withGrokTranslatedBio: true,
    };
    // SearchTimeline no longer accepts fieldToggles (see buildUrl comment).
    const url = buildUrl(searchOp, searchOpId, variables, DEFAULT_FEATURES, {});
    const res = await http.get<any>(url, { headers });
    return res;
  }

  let res = await callTimeline('People');
  let fallbackUsed = false;
  if (res.status === 404 || res.status === 410) {
    fallbackUsed = true;
    res = await callTimeline('Top');
    if (res.status === 404 || res.status === 410) {
      res = await callTimeline('Latest');
    }
  }

  if (res.status === 401 || res.status === 403) {
    throw new AdapterAuthError(res.status, 'X rejected cookie/csrf during user discovery');
  }
  if (res.status === 429) {
    throw new AdapterAuthError(429, 'X rate-limited this account — slow down or rotate session');
  }
  if (res.status === 404 || res.status === 410) {
    // All direct-axios paths are gated by x-client-transaction-id now.
    // Drive a real headless browser instead — slower but works. Only log
    // the fallback once per process — every search hits this path so the
    // log was repeating on every cron tick.
    if (!searchTimelineFallbackLogged) {
      console.warn('[x] SearchTimeline direct path returns 404 — using playwright for all subsequent searches (this notice prints once per process)');
      searchTimelineFallbackLogged = true;
    }
    return searchUsersByKeywordViaBrowser(opts);
  }
  if (res.status !== 200) {
    throw new AdapterAuthError(res.status, `X discover http=${res.status}`);
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
    const msg = res.data.errors[0]?.message || 'unknown GraphQL error';
    throw new AdapterAuthError(400, `X GraphQL rejected discover: ${msg.slice(0, 120)}`);
  }

  // ── Extract users from the response tree ────────────────────────────────
  // Same response shape for both products. People product surfaces standalone
  // <User> nodes; Latest surfaces <Tweet> nodes whose `core.user_results.result`
  // is a User. The walker catches both.
  const users: any[] = [];
  walk(res.data, (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.__typename === 'User' && (node.legacy || node.core)) users.push(node);
  });

  // Tally how many times each author appears (Latest path uses this as a
  // proxy for relevance — accounts posting many matching tweets are likely
  // the most on-topic). People path keeps server-supplied ordering since
  // X already ranked them.
  const tally = new Map<string, number>();
  const byHandle = new Map<string, XUserSummary>();
  for (const u of users) {
    const screen: string = u.legacy?.screen_name || u.core?.screen_name || '';
    if (!screen) continue;
    const key = screen.toLowerCase();
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (!byHandle.has(key)) {
      byHandle.set(key, {
        screen_name: screen,
        name: u.legacy?.name || u.core?.name || '',
        description: u.legacy?.description || '',
        followers_count: Number(u.legacy?.followers_count ?? 0),
        profile_image_url: u.legacy?.profile_image_url_https || u.avatar?.image_url || '',
        verified: !!(u.legacy?.verified || u.is_blue_verified || u.verification?.verified),
      });
    }
  }

  const out = Array.from(byHandle.values());
  if (fallbackUsed) {
    // Latest path: sort by (tweet count for this query) DESC, then followers.
    out.sort((a, b) => {
      const ca = tally.get(a.screen_name.toLowerCase()) ?? 0;
      const cb = tally.get(b.screen_name.toLowerCase()) ?? 0;
      if (cb !== ca) return cb - ca;
      return b.followers_count - a.followers_count;
    });
  } else {
    // People path: X ranked them; we re-stabilise by followers desc.
    out.sort((a, b) => b.followers_count - a.followers_count);
  }
  return out;
}

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

// ── Tweet replies fetcher (评论同步 worker 用)──────────────────────────────
//
// 调 X 的 TweetDetail GraphQL 拿一条推文的整条 conversation thread,然后筛出
// in_reply_to_status_id_str === focalTweetId 的回复(直接 reply,不含 reply-to-reply)。
// 用同一 source 的 cookie(运营建源时录的那个),所以哪条源采的就用哪个 cookie 抓回复,
// 避开"一个 X 账号读全站所有源"的限流风险。
//
// X 的 opId / features 都会轮换,挂 404 / 401 时 worker 走 best-effort:这条
// item 留着下次重试,不抛任何业务异常。

export interface XReply {
  /** 回复 tweet 的 legacy.id_str — 同步表的 external_id */
  tweetId: string;
  /** 评论者 @handle (不带 @) */
  authorHandle: string;
  /** 评论者 X profile display name(可能为中文 / emoji) */
  authorName: string;
  /** 评论者头像 URL,空时调用方回落到渐变方块 */
  authorAvatar: string | null;
  /** 评论正文(legacy.full_text) */
  body: string;
  /** 原平台发表时间 */
  postedAt: Date;
}

export interface XTweetThread {
  /** focal tweet 自己的 view count(原平台累计查看数), 拿不到时 null */
  focalViewCount: number | null;
  /** focal tweet 的直接回复 */
  replies: XReply[];
}

export async function fetchTweetReplies(
  source: SourceRow,
  tweetId: string,
  opts: { limit?: number } = {},
): Promise<XTweetThread> {
  const empty: XTweetThread = { focalViewCount: null, replies: [] };
  if (!tweetId) return empty;
  const auth = await resolveAuth(source);
  const cookie = auth.cookie;
  if (!cookie) {
    throw new AdapterAuthError(401, 'X reply fetcher needs cookie (set credential or config.cookie)');
  }
  const csrf = (extractCt0(cookie) || '').trim();
  if (!csrf) {
    throw new AdapterAuthError(401, 'X reply fetcher could not derive csrf from cookie');
  }

  const cfg = source.config as Config;
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
    referer: `https://x.com/i/status/${tweetId}`,
    cookie,
  };
  const features = { ...DEFAULT_FEATURES, ...(cfg.features || {}) };
  const fieldToggles = { ...DEFAULT_FIELD_TOGGLES, ...(cfg.fieldToggles || {}) };
  const opIds = { ...DEFAULT_OP_IDS, ...(cfg.opIds || {}) };

  // X 的 TweetDetail 用 GET + URLSearchParams variables;referrer 设到这条 tweet
  // 提高被反爬识别为正常浏览的概率。
  const variables = {
    focalTweetId: tweetId,
    referrer: 'tweet',
    with_rux_injections: false,
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: false,
    withBirdwatchNotes: false,
    withVoice: false,
    withV2Timeline: true,
  };
  const url = buildUrl('TweetDetail', opIds.TweetDetail, variables, features, fieldToggles);
  const res = await http.get<any>(url, { headers });

  if (res.status === 401 || res.status === 403) {
    throw new AdapterAuthError(res.status, 'X rejected cookie/csrf for TweetDetail');
  }
  if (res.status === 429) {
    throw new AdapterAuthError(429, 'X rate-limited TweetDetail');
  }
  // 404/410 一般是 opId 过期 — 抛 AdapterAuthError 让 worker 标 authFail,
  // 也借此提醒去更 X_OPID_TWEET_DETAIL。
  if (res.status === 404 || res.status === 410) {
    throw new AdapterAuthError(
      res.status,
      `X TweetDetail returned ${res.status} — opId "${opIds.TweetDetail}" likely outdated, set X_OPID_TWEET_DETAIL`,
    );
  }
  if (res.status !== 200) {
    console.warn(`[x] TweetDetail tweet=${tweetId} http=${res.status}`);
    return empty;
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
    const msg = res.data.errors[0]?.message || 'unknown GraphQL error';
    // 删帖 / 私密帖会返回 errors 但 status=200;静默跳过,不当 authFail
    console.warn(`[x] TweetDetail tweet=${tweetId} GraphQL err: ${msg.slice(0, 100)}`);
    return empty;
  }

  // 走通用 walker 拿所有 Tweet 节点,然后筛出"直接回复 focalTweet"那些。
  // reply-of-reply (子回复)暂时不抓 — 一来增加复杂度,二来真要做最好分页。
  const allTweets = extractTweetsFromTimeline(res.data);
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);

  // 顺手从 allTweets 里找出 focal tweet, 提取它的 view_count。
  // X 新 schema 在 t.views.count(字符串),老 schema 在 legacy.view_count;两者都试。
  // String() 强转两边 — 老 GraphQL 偶尔会把 rest_id 返成 number, === 直接比对会漏。
  let focalViewCount: number | null = null;
  const focal = allTweets.find((t) => String(t.rest_id ?? t.legacy?.id_str ?? '') === tweetId);
  if (focal) {
    const v = focal.views?.count ?? focal.legacy?.view_count ?? null;
    if (v != null && v !== '') {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n >= 0) focalViewCount = Math.floor(n);
    }
  }

  const replies: XReply[] = [];
  const seenTweetIds = new Set<string>();
  for (const t of allTweets) {
    const legacy = t.legacy ?? {};
    // String() 强转 — X GraphQL 偶尔把 id_str / rest_id 返回成 number, 跟字符串 tweetId 直接 === 会漏。
    const id = String(legacy.id_str ?? t.rest_id ?? '');
    if (!id || id === tweetId) continue;  // 跳过 focal tweet 本身
    if (seenTweetIds.has(id)) continue;
    if (String(legacy.in_reply_to_status_id_str ?? '') !== tweetId) continue;
    // 跳过 retweet 包装 — replies 不应该是 RT
    if (legacy.retweeted_status_result) continue;

    const user = t.core?.user_results?.result;
    const userLegacy = user?.legacy ?? {};
    const handle = (userLegacy.screen_name || user?.core?.screen_name || '').trim();
    if (!handle) continue;
    const displayName = userLegacy.name || user?.core?.name || handle;
    const rawAvatar: string | null = userLegacy.profile_image_url_https
                                 ?? user?.avatar?.image_url ?? null;
    const avatar = rawAvatar ? rawAvatar.replace(/_normal(\.\w+)$/, '_200x200$1') : null;
    const text = (legacy.full_text || '').trim();
    if (!text) continue;
    const posted = legacy.created_at ? new Date(legacy.created_at) : null;
    if (!posted || Number.isNaN(posted.getTime())) continue;

    seenTweetIds.add(id);
    replies.push({
      tweetId: id,
      authorHandle: handle.slice(0, 64),
      authorName: String(displayName).slice(0, 128),
      authorAvatar: avatar ? avatar.slice(0, 512) : null,
      body: text,
      postedAt: posted,
    });

    if (replies.length >= limit) break;
  }
  return { focalViewCount, replies };
}
