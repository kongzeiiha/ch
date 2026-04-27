// Verify stealth patches by inspecting navigator/window from inside a rendered
// page. Compares headless Chromium WITH stealth (renderer.ts) vs raw Playwright.
//
// Run:  node apps/api/scripts/test-stealth.mjs

import { chromium as plainChromium } from 'playwright';
import { chromium as stealthyChromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
stealthyChromium.use(stealth);

const PROBE_SCRIPT = `({
  webdriver: navigator.webdriver,
  plugins: navigator.plugins.length,
  languages: navigator.languages,
  hasChrome: typeof window.chrome,
  permissions: typeof navigator.permissions,
  vendor: navigator.vendor,
  platform: navigator.platform,
  hardwareConcurrency: navigator.hardwareConcurrency,
})`;

async function probe(name, browserType) {
  const b = await browserType.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const p = await ctx.newPage();
  await p.goto('about:blank');
  const r = await p.evaluate(PROBE_SCRIPT);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
  return r;
}

const plain = await probe('plain Playwright (no stealth)', plainChromium);
const stealthy = await probe('stealth Playwright', stealthyChromium);

console.log('\n=== diff ===');
const keys = new Set([...Object.keys(plain), ...Object.keys(stealthy)]);
for (const k of keys) {
  const a = JSON.stringify(plain[k]);
  const b = JSON.stringify(stealthy[k]);
  if (a !== b) console.log(`  ${k}: plain=${a} → stealth=${b}`);
}
