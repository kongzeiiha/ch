// Higher-resolution screenshot of the vertical-stepper pipeline view.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/wb-vertical.png', fullPage: false });

// Click stage 3 (classify-title) to verify selection switching works
const stage3 = page.locator('button:has(span:text("#3"))').first();
if (await stage3.count() > 0) {
  await stage3.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/wb-vertical-stage3.png', fullPage: false });
}

console.log('errors:', errors.filter(e => !/Warning|border|404 main-app|Failed to load resource/i.test(e)));
await browser.close();
