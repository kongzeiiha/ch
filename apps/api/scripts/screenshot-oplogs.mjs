// Headless visual test for the new "操作日志" tab on /workbench.
// Verifies:
//   1. The tab is clickable and renders the panel
//   2. The table shows real rows from /admin/op-logs
//   3. The detail modal opens when a row is clicked
// Saves three screenshots to /tmp.

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/workbench';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(1500);

// 1. Click the 操作日志 tab.
const tabBtn = page.getByRole('button', { name: '操作日志' });
const tabCount = await tabBtn.count();
if (tabCount === 0) { console.error('✗ 未找到 "操作日志" tab'); process.exit(1); }
console.log(`✓ tab "操作日志" found (${tabCount} match)`);
await tabBtn.first().click();
await page.waitForTimeout(800); // wait for the fetch + render

// 2. Confirm the filter bar shows up.
const filterInput = page.getByPlaceholder('操作人');
if (await filterInput.count() === 0) { console.error('✗ 过滤栏未渲染'); process.exit(1); }
console.log('✓ 过滤栏渲染');

// 3. Wait for the row count "共 N 条" badge to appear. Indicates fetch resolved.
await page.getByText(/共 \d+ 条/).first().waitFor({ timeout: 10_000 });
const totalText = await page.getByText(/共 \d+ 条/).first().textContent();
console.log(`✓ 总数显示: ${totalText}`);

await page.screenshot({ path: '/tmp/oplogs-list.png', fullPage: true });
console.log('✓ 列表截图 → /tmp/oplogs-list.png');

// 4. Filter test: type "alice" + Enter, expect total to refresh.
await filterInput.first().click();
await filterInput.first().fill('alice');
await filterInput.first().press('Enter');
await page.waitForTimeout(800);
const filteredText = await page.getByText(/共 \d+ 条/).first().textContent();
console.log(`✓ 筛选 alice 后总数: ${filteredText}`);
await page.screenshot({ path: '/tmp/oplogs-filtered.png', fullPage: true });
console.log('✓ 筛选截图 → /tmp/oplogs-filtered.png');

// 5. Click first row → modal opens.
const firstRow = page.locator('table tbody tr').first();
const rowCount = await page.locator('table tbody tr').count();
if (rowCount === 0) { console.error('✗ 表格无数据,先在 API 触发一些操作再跑'); await browser.close(); process.exit(1); }
console.log(`✓ 表格 ${rowCount} 行可见`);
await firstRow.click();
await page.waitForTimeout(400);

// Modal should contain a "Payload" label.
const payloadLabel = page.getByText('Payload', { exact: true });
if (await payloadLabel.count() === 0) { console.error('✗ 详情弹窗未打开'); await browser.close(); process.exit(1); }
console.log('✓ 详情弹窗打开');

await page.screenshot({ path: '/tmp/oplogs-modal.png', fullPage: false });
console.log('✓ 弹窗截图 → /tmp/oplogs-modal.png');

if (errors.length) {
  console.log('\n--- console / page errors ---');
  for (const e of errors) console.log('  ' + e);
}

await browser.close();
console.log('\n✓ 全部检查通过');
