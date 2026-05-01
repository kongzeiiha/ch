import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = []; const requests = [];
page.on('response', (r) => { if (r.status() === 404) requests.push(r.url()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
await page.goto('http://localhost:3000/workbench', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3500);
const stillLoading = await page.evaluate(() => document.body.textContent?.includes('连接中…'));
const numActiveCards = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).filter(b => /^#\d+$/.test(b.querySelector('span')?.textContent?.trim() ?? '')).length
);
console.log('still loading after 3.5s:', stillLoading);
console.log('flow strip cards:', numActiveCards);
console.log('404 urls:', requests);
console.log('errors:', errors);
await page.screenshot({ path: '/tmp/wb-after-load.png', fullPage: true });
await browser.close();
