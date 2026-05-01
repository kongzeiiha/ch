import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserType } from 'playwright';

/**
 * Stealth Playwright login for x.com.
 *
 * Drops you on the login page, types username + password, watches what X does
 * next, and either:
 *   - succeeds      → returns the new cookie + UA
 *   - hits a wall   → returns failureReason ∈
 *                       'arkose'        (FunCaptcha challenge — needs human / paid solver)
 *                       '2fa'           (Authenticator / SMS code prompt)
 *                       'email-challenge'  (X wants the code from email — common on new device/IP)
 *                       'unusual-activity' (X showed a "we noticed unusual activity" speed-bump)
 *                       'wrong-password'
 *                       'rate-limited'
 *                       'timeout'
 *                       'unknown'
 *
 * What this DOES NOT do (yet, by design):
 *   - solve Arkose
 *   - generate TOTP codes
 *   - read the email-verification code
 *
 * If any of those appear, the worker logs the failure and humans take over.
 * Per the agreed Plan A, automatic refresh runs at most once per credential
 * per N days, so triggering Arkose remains rare.
 */

// Stealth plugin shared across this module — same setup the ingestion renderer
// uses. We instantiate a dedicated chromium because we want isolated browser
// contexts per login attempt (no cookie carry-over between accounts).
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
const chromium = chromiumExtra as unknown as BrowserType;
chromiumExtra.use(stealth);

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export type LoginFailureReason =
  | 'arkose'
  | '2fa'
  | 'email-challenge'
  | 'unusual-activity'
  | 'wrong-password'
  | 'rate-limited'
  | 'timeout'
  | 'unknown';

export interface LoginSuccess {
  ok: true;
  cookie: string;
  userAgent: string;
  authToken: string;
  ct0: string;
  durationMs: number;
}

export interface LoginFailure {
  ok: false;
  reason: LoginFailureReason;
  detail: string;
  durationMs: number;
  /** When set, callers (worker) can dump this to disk for forensic review. */
  screenshotPng?: Buffer;
}

export type LoginResult = LoginSuccess | LoginFailure;

const LOGIN_URL = 'https://x.com/i/flow/login';
const STEP_TIMEOUT_MS = 20_000;

export async function loginToX(opts: {
  username: string;
  password: string;
  /** Capture screenshot on failure for human review. Default true. */
  captureScreenshotOnFail?: boolean;
}): Promise<LoginResult> {
  const start = Date.now();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: REAL_UA,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      colorScheme: 'light',
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // Step 1 — username field.
    // X has shipped at least 3 variants of the login form: `autocomplete=username`,
    // a combined `name=text` input on the unified form, and an OCF-prefixed test id.
    // Race them so a one-variant change doesn't kill auto-refresh, and bail with
    // a screenshot if NONE shows up — that's how the "Suspicious activity"
    // interstitial / Cloudflare challenge / cookie banner manifests.
    const usernameLocator = page.locator(
      [
        'input[autocomplete="username"]',
        'input[name="text"]',
        'input[data-testid="ocfEnterTextTextInput"]',
      ].join(', '),
    ).first();
    try {
      await usernameLocator.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    } catch {
      return await fail(page, 'timeout', 'No username input appeared (X may be showing a challenge / consent / rate-limit interstitial — check screenshot)', start, opts);
    }
    await usernameLocator.fill(opts.username);
    await page.locator('button:has-text("Next"), [role="button"]:has-text("Next")').first().click().catch(() => {
      // Fallback: pressing Enter advances the form on most variants.
    });

    // Step 2 — what came back?
    // Possible next pages, race them:
    //   - password input  →  happy path
    //   - "Enter your phone number or email address"  → unusual activity
    //   - Arkose iframe   → captcha
    //   - 2FA code input  → 2fa
    //   - "We sent your verification code"  → email-challenge
    //   - error toast about wrong username  → unknown / wrong-username
    const next = await Promise.race([
      page.locator('input[name="password"], input[autocomplete="current-password"]').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'password' as const),
      page.locator('text=/unusual login activity|verify your identity/i').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'unusual' as const),
      page.locator('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'arkose' as const),
      page.locator('text=/check your email|sent.*verification code/i').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'email' as const),
    ]).catch(() => 'timeout' as const);

    if (next === 'arkose') {
      return await fail(page, 'arkose', 'Arkose / FunCaptcha challenge appeared', start, opts);
    }
    if (next === 'email') {
      return await fail(page, 'email-challenge', 'X requested the email verification code', start, opts);
    }
    if (next === 'unusual') {
      return await fail(page, 'unusual-activity', 'X showed unusual-activity speed-bump', start, opts);
    }
    if (next === 'timeout') {
      return await fail(page, 'timeout', 'Did not see password prompt within 20s', start, opts);
    }

    // Step 3 — type password and submit.
    await page.locator('input[name="password"], input[autocomplete="current-password"]').first().fill(opts.password);
    await page.keyboard.press('Enter').catch(() => {});

    // Step 4 — what came back THIS time?
    const after = await Promise.race([
      page.waitForURL(/x\.com\/(home|i\/flow|.*)/, { timeout: STEP_TIMEOUT_MS })
        .then(async () => {
          // Sometimes URL doesn't change — also check for the home timeline.
          const home = await page.locator('a[data-testid="AppTabBar_Home_Link"]').first()
            .isVisible().catch(() => false);
          return home ? 'home' as const : 'url-changed' as const;
        }),
      page.locator('text=/Wrong password|incorrect password/i').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'wrong-password' as const),
      page.locator('input[name="text"][data-testid="ocfEnterTextTextInput"]').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => '2fa' as const),
      page.locator('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]').first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).then(() => 'arkose' as const),
    ]).catch(() => 'timeout' as const);

    if (after === 'wrong-password') return await fail(page, 'wrong-password', 'X reported wrong password', start, opts);
    if (after === '2fa')            return await fail(page, '2fa', 'X requested 2FA code', start, opts);
    if (after === 'arkose')         return await fail(page, 'arkose', 'Arkose appeared after password submit', start, opts);
    if (after === 'timeout')        return await fail(page, 'timeout', 'No navigation/prompt 20s after password submit', start, opts);

    // Step 5 — collect cookies.
    const cookies = await ctx.cookies('https://x.com');
    const authToken = cookies.find(c => c.name === 'auth_token')?.value ?? '';
    const ct0       = cookies.find(c => c.name === 'ct0')?.value ?? '';
    if (!authToken || !ct0) {
      return await fail(page, 'unknown', `auth_token=${!!authToken} ct0=${!!ct0} — login navigated but cookies missing`, start, opts);
    }
    const cookieHeader = cookies
      .filter(c => c.name !== '__cf_bm')
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    return {
      ok: true,
      cookie: cookieHeader,
      userAgent: REAL_UA,
      authToken,
      ct0,
      durationMs: Date.now() - start,
    };
  } catch (e: any) {
    // Best-effort screenshot from the active page so post-mortem can see WHAT
    // X actually showed (e.g. Cloudflare challenge, "unusual activity", login
    // form redesign). Without this, all crashes look identical from the DB.
    let screenshotPng: Buffer | undefined;
    if (opts.captureScreenshotOnFail !== false && browser) {
      try {
        const ctx = browser.contexts()[0];
        const page = ctx?.pages()[0];
        if (page) screenshotPng = await page.screenshot({ fullPage: false });
      } catch { /* ignore — already failing */ }
    }
    return {
      ok: false,
      reason: 'unknown',
      detail: `crash: ${e?.message ?? e}`.slice(0, 300),
      durationMs: Date.now() - start,
      screenshotPng,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function fail(
  page: any,
  reason: LoginFailureReason,
  detail: string,
  start: number,
  opts: { captureScreenshotOnFail?: boolean },
): Promise<LoginFailure> {
  let screenshotPng: Buffer | undefined;
  if (opts.captureScreenshotOnFail !== false) {
    try {
      screenshotPng = await page.screenshot({ fullPage: false });
    } catch { /* ignore — already failing */ }
  }
  return { ok: false, reason, detail: detail.slice(0, 300), durationMs: Date.now() - start, screenshotPng };
}
