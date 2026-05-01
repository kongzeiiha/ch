// Verify that:
//   1. Add-source form's platform dropdown shows only X
//   2. Batch import modal shows only X (no Bluesky/Reddit tabs)
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1) Sources tab → 添加来源 form
await page.locator('button:has-text("采集源")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("添加来源")').click();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/x-only-add.png', fullPage: false });

// Inspect the platform dropdown options programmatically
const opts = await page.evaluate(() => {
  const sel = document.querySelector('select');
  return Array.from(sel?.querySelectorAll('option') ?? []).map(o => o.value);
});
console.log('add-source platform options:', opts);

// Cancel the add form
const cancelBtn = page.locator('button:has-text("取消")');
if (await cancelBtn.count() > 0) await cancelBtn.first().click();
await page.waitForTimeout(400);

// 2) Batch import modal
await page.locator('button:has-text("批量导入博主")').click();
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/x-only-batch.png', fullPage: false });

// Count platform tabs in batch modal
const batchTabs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button'))
    .filter(b => /^X \(Twitter\)$|^Bluesky$|^Reddit$/.test(b.textContent ?? ''))
    .map(b => b.textContent);
});
console.log('batch modal platform tabs:', batchTabs);

console.log('errors:', errors.filter(e => !/border|Warning/.test(e)));
await browser.close();
