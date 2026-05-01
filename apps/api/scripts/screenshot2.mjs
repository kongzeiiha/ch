import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/wb-final.png', fullPage: true });
// Click stage #5 (compliance) to verify selection switching works
const stages = await page.$$('button:has(span:text-matches("^#\\\\d+$"))');
if (stages.length >= 5) {
  await stages[4].click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/wb-clicked-compliance.png', fullPage: true });
  console.log('clicked stage #5, captured second screenshot');
}
await browser.close();
