// Visual smoke for the auto-refresh credential form.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

await page.locator('button:has-text("采集源")').first().click();
await page.waitForTimeout(700);
await page.locator('button:has-text("批量导入博主")').click();
await page.waitForTimeout(500);

// Click "+ 新建凭证" to open the inline form
await page.locator('button:has-text("新建凭证")').click();
await page.waitForTimeout(400);

// Expand the auto-refresh details
await page.locator('summary:has-text("配置自动刷新")').click();
await page.waitForTimeout(400);

await page.screenshot({ path: '/tmp/cred-secret-form.png', fullPage: false });

console.log('errors:', errors.filter(e => !/Warning|border|404 main-app|Failed to load resource/i.test(e)));
await browser.close();
