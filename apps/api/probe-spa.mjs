import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://vph.dvandme.com/app/#/detail?mode=img&tid=590&sid=&id=53813';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) ch-agents/0.1',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

const reqs = { document: 0, image: 0, xhr: 0, fetch: 0, script: 0, other: 0 };
page.on('request', (r) => {
  const t = r.resourceType();
  reqs[t] = (reqs[t] || 0) + 1;
});
const imageUrls = new Set();
page.on('response', async (r) => {
  if (r.request().resourceType() === 'image') imageUrls.add(r.url());
});

console.log('navigating...');
await page.goto(URL, { timeout: 30_000, waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 20_000 }); } catch {}
await page.waitForTimeout(8_000);
console.log('current URL after settle:', page.url());

const counts = await page.evaluate(() => ({
  imgTags: document.querySelectorAll('img').length,
  imgWithSrc: document.querySelectorAll('img[src]').length,
  imgWithDataSrc: document.querySelectorAll('img[data-src]').length,
  picture: document.querySelectorAll('picture').length,
  bgImages: Array.from(document.querySelectorAll('*'))
    .filter(el => /url\(/.test(getComputedStyle(el).backgroundImage || '')).length,
  canvas: document.querySelectorAll('canvas').length,
  videos: document.querySelectorAll('video').length,
  bodyText: document.body?.innerText?.slice(0, 200) || '',
  htmlLen: document.documentElement.outerHTML.length,
}));
console.log('DOM counts:', counts);
console.log('Network reqs:', reqs);
console.log('Image responses (first 10):');
[...imageUrls].slice(0, 10).forEach(u => console.log('  ', u));
console.log(`Total image network responses: ${imageUrls.size}`);

await browser.close();
