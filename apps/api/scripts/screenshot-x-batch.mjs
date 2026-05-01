// Screenshot the crawl preview, filtered by each handle from the batch import,
// to demo "看到每个博主的视频/图片" for the user.
import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });

const filePath = path.resolve('/Users/mac/AUD/ch/promote/crawl-preview.html');
await page.goto('file://' + filePath, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Always filter to platform=x first
await page.locator('#filter-platform').selectOption('x');
await page.waitForTimeout(200);

const handles = ['natgeo', 'nasa', 'spacex', 'earthcurated', 'earthpix'];
for (const h of handles) {
  await page.locator('#filter-text').fill(h);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/crawl-${h}.png`, fullPage: false });
}

// Open lightbox on a video tweet
await page.locator('#filter-text').fill('spacex');
await page.waitForTimeout(400);
const vidThumb = page.locator('article.card:visible .thumb[data-video]').first();
if (await vidThumb.count() > 0) {
  await vidThumb.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/crawl-spacex-lightbox.png', fullPage: false });
}

console.log(`captured ${handles.length} per-handle screenshots + lightbox`);
await browser.close();
