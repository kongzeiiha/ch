// Screenshot: source-scoring (#1) + ingestion (#2) detail with the new
// "近24h 调用" tile, plus a stage with full live strip (#3 classify-title).
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

for (const num of [1, 2, 3]) {
  await page.locator(`button:has(span:text("#${num}"))`).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/wb-stage-${num}.png`, fullPage: false });
}
console.log('captured 3 screenshots');
await browser.close();
