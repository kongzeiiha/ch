import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://xx.knit.bid/article/30689/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

console.log('navigating to:', URL);
const resp = await page.goto(URL, { timeout: 40_000, waitUntil: 'domcontentloaded' });
console.log('status:', resp?.status(), 'url:', page.url());

try { await page.waitForLoadState('networkidle', { timeout: 20_000 }); } catch {}
await page.waitForTimeout(5_000);
console.log('final URL:', page.url());

const counts = await page.evaluate(() => ({
  imgTags: document.querySelectorAll('img').length,
  imgWithSrc: document.querySelectorAll('img[src]').length,
  picture: document.querySelectorAll('picture').length,
  videos: document.querySelectorAll('video').length,
  htmlLen: document.documentElement.outerHTML.length,
  title: document.title,
  bodyHead: (document.body?.innerText || '').slice(0, 300),
}));
console.log('DOM:', counts);

const imgs = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('img').forEach((el) => {
    out.push({
      src: el.getAttribute('src'),
      dataSrc: el.getAttribute('data-src'),
      alt: (el.getAttribute('alt') || '').slice(0, 60),
      w: el.naturalWidth, h: el.naturalHeight,
    });
  });
  return out;
});
console.log(`\n=== ${imgs.length} <img> tags ===`);
imgs.slice(0, 20).forEach((x, i) => console.log(`[${i}] ${x.w}x${x.h}  ${x.src || x.dataSrc}  alt=${x.alt}`));

await browser.close();
