// Visual smoke test: open Sources tab, click "批量导入博主", capture modal.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Click the "采集源" tab
await page.locator('button:has-text("采集源")').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/sources-tab.png', fullPage: false });

// Click the "批量导入博主" button
await page.locator('button:has-text("批量导入博主")').click();
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/batch-modal.png', fullPage: false });

// Switch to Bluesky to verify platform toggle works
await page.locator('button:has-text("Bluesky")').click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/batch-modal-bsky.png', fullPage: false });

console.log('errors:', errors.filter(e => !/border|Warning/.test(e)));

await browser.close();
