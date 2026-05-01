// Visual smoke: open Sources tab, open batch modal, verify credential picker
// renders with the X credential we created during integration tests (or any
// other), then capture screenshots for each platform tab.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Sources tab + batch modal
await page.locator('button:has-text("采集源")').first().click();
await page.waitForTimeout(800);
await page.locator('button:has-text("批量导入博主")').click();
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/wb-batch-x-with-credpicker.png', fullPage: false });

// Switch to Reddit tab — should see sort/time selectors instead of cookie
await page.locator('button:has-text("Reddit")').click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/wb-batch-reddit.png', fullPage: false });

console.log('errors:', errors.filter(e => !/border|Warning|404 main-app/.test(e)));

await browser.close();
