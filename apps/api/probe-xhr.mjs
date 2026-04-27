import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://uib.2ksg.com/app/#/detail?mode=img&tid=591&sid=&id=45499';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: {
    'token': '6208330590a87f',
    'Referer': 'https://uib.2ksg.com/app/',
  },
});
const page = await ctx.newPage();

const xhrs = [];
page.on('response', async (r) => {
  const t = r.request().resourceType();
  if (t !== 'xhr' && t !== 'fetch') return;
  let body = '';
  try { body = (await r.text()).slice(0, 400); } catch {}
  xhrs.push({
    url: r.url(),
    status: r.status(),
    ct: r.headers()['content-type'] || '',
    bodyHead: body,
  });
});

const imageUrls = [];
page.on('response', (r) => {
  if (r.request().resourceType() === 'image') imageUrls.push(r.url());
});

console.log('navigating to:', URL);
await page.goto(URL, { timeout: 30_000, waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 20_000 }); } catch {}
await page.waitForTimeout(8_000);
console.log('final URL:', page.url());

console.log(`\n=== ${xhrs.length} XHR/Fetch requests ===\n`);
xhrs.forEach((x, i) => {
  console.log(`[${i}] ${x.status}  ${x.url}`);
  console.log(`    ct=${x.ct}`);
  console.log(`    body[0:400]=${x.bodyHead.replace(/\n/g, ' ')}`);
  console.log();
});

console.log(`\n=== ${imageUrls.length} image responses (first 5) ===\n`);
imageUrls.slice(0, 5).forEach((u) => console.log('  ', u));

await browser.close();
