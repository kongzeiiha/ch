// Headless screenshot of the crawl-preview HTML, filtered to X tweets so the
// user sees the live X.com fetch result we just produced.
import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const filePath = path.resolve('/Users/mac/AUD/ch/promote/crawl-preview.html');
await page.goto('file://' + filePath, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Filter to natgeo source — those are the items we just live-fetched
await page.locator('#filter-platform').selectOption('x');
await page.locator('#filter-text').fill('natgeo');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/crawl-natgeo.png', fullPage: false });

// Show NASA tweets
await page.locator('#filter-text').fill('nasa');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/crawl-nasa.png', fullPage: false });

// Combined natgeo+nasa — clear text, filter only-with-video on, X platform
await page.locator('#filter-text').fill('');
await page.locator('#filter-video').check();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/crawl-x-videos.png', fullPage: false });

// Open a lightbox on a natgeo tweet with a video
await page.locator('#filter-video').uncheck();
await page.locator('#filter-text').fill('natgeo');
await page.waitForTimeout(400);
const firstVidThumb = page.locator('.card[style*="display: none"] >> visible=false').nth(0);
const allThumbs = await page.locator('article.card:visible .thumb[data-video]').first();
if (await allThumbs.count() > 0) {
  await allThumbs.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/crawl-lightbox.png', fullPage: false });
}

console.log('captured 3 screenshots');
await browser.close();
