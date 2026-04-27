import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserType } from 'playwright';

/**
 * Headless Chromium for SPA / JS-rendered sites, hardened against bot
 * detection (route 3 of the anti-anti-scrape playbook).
 *
 * Defenses applied:
 *   1. Stealth plugin — patches navigator.webdriver, navigator.plugins,
 *      navigator.languages, chrome.runtime, WebGL fingerprint, permissions
 *      API, and ~17 other common detection vectors.
 *   2. Real Chrome User-Agent (no "ch-agents" branding).
 *   3. Realistic context: viewport, locale, timezone, color scheme, headers.
 *   4. waitForSelector wait — wait for actual content to appear instead of
 *      blindly trusting `networkidle` (many SPAs never reach networkidle).
 *   5. Optional cookie injection for sites needing a logged-in session.
 *   6. Optional extra headers (e.g. cf-clearance from a real session).
 */

const stealth = StealthPlugin();
// Disable a couple evasions that occasionally trigger anti-stealth detection
// (this is the recommendation from the stealth plugin's own docs).
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
const chromium = chromiumExtra as unknown as BrowserType;
chromiumExtra.use(stealth);

let _browser: Browser | null = null;
let _launching: Promise<Browser> | null = null;

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launching) return _launching;
  _launching = chromium
    .launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // These help blend in with the typical Chrome desktop fingerprint.
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--lang=en-US,en',
      ],
    })
    .then((b) => {
      _browser = b;
      _launching = null;
      b.on('disconnected', () => { _browser = null; });
      return b;
    });
  return _launching;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* noop */ }
    _browser = null;
  }
}

export interface CookieDef {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface RenderOptions {
  /** Wait at most this long for the page to settle. */
  timeoutMs?: number;
  /** Extra delay after 'networkidle' to let lazy images fire. */
  settleMs?: number;
  /** If set, wait until at least 1 element matching this selector exists. */
  waitForSelector?: string;
  /** If set, override the User-Agent for this navigation. */
  userAgent?: string;
  /** Cookies to inject before navigating (use for sites needing login). */
  cookies?: CookieDef[];
  /** Extra HTTP headers to send on every request from this context. */
  extraHeaders?: Record<string, string>;
  /** Optional locale, e.g. 'zh-CN'. Defaults to 'en-US'. */
  locale?: string;
  /** Optional timezone, e.g. 'Asia/Shanghai'. Defaults to 'America/New_York'. */
  timezoneId?: string;
}

/**
 * Navigate to url in headless Chromium, wait for JS rendering to settle,
 * return the final HTML. Hardened with stealth patches against common
 * bot-detection (navigator.webdriver, plugins, languages, etc).
 */
export async function renderPage(url: string, opts: RenderOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const settleMs = opts.settleMs ?? 1_200;
  const userAgent = opts.userAgent ?? REAL_UA;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 900 },
    locale: opts.locale ?? 'en-US',
    timezoneId: opts.timezoneId ?? 'America/New_York',
    colorScheme: 'light',
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...(opts.extraHeaders ?? {}),
    },
  });

  if (opts.cookies?.length) {
    await context.addCookies(opts.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
    })));
  }

  const page = await context.newPage();
  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });

    if (opts.waitForSelector) {
      // Prefer selector wait when caller knows what content to expect — way
      // more reliable than networkidle for SPAs that never go quiet.
      try {
        await page.waitForSelector(opts.waitForSelector, { timeout: timeoutMs, state: 'attached' });
      } catch { /* fall through; selector may not appear, return whatever we have */ }
    } else {
      // networkidle is best-effort — many SPAs never reach it, swallow timeout.
      try {
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
      } catch { /* swallow */ }
    }

    if (settleMs > 0) await page.waitForTimeout(settleMs);
    return await page.content();
  } finally {
    try { await page.close(); } catch { /* noop */ }
    try { await context.close(); } catch { /* noop */ }
  }
}
