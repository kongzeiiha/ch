// Headless visual smoke test for the redesigned workbench pipeline view.
// Saves a screenshot to /tmp/workbench.png and prints a summary of what's rendered.

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:3000/workbench';
const OUT = '/tmp/workbench.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
});

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });

// Wait a beat for the auto-poll to populate state
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: true });
console.log(`✓ saved ${OUT}`);

// Inspect DOM to verify the new flow strip is present and detail panel renders.
const summary = await page.evaluate(() => {
  // Flow strip cards: buttons inside the first big rounded panel under tabbar
  const flowButtons = Array.from(document.querySelectorAll('button')).filter(b => {
    const num = b.querySelector('span');
    return num && /^#\d+$/.test(num.textContent?.trim() ?? '');
  });
  const stageNames = flowButtons.map(b => {
    const nameEl = b.querySelectorAll('div')[1];
    return nameEl?.textContent?.trim() ?? '';
  });
  const dotColors = flowButtons.map(b => {
    const dot = b.querySelector('span[style*="border-radius: 50%"]');
    return dot ? getComputedStyle(dot).background : '';
  });
  // Find the detail panel: look for "近 24h 成败" caption (only in detail card)
  const hasDetail = !!Array.from(document.querySelectorAll('div'))
    .find(d => d.textContent?.includes('近 24h 成败'));
  // Stats grid: 4 cards under detail
  const statsCards = Array.from(document.querySelectorAll('div'))
    .filter(d => /近 24h|平均延迟|待处理|成本/.test(d.textContent ?? ''))
    .filter(d => /uppercase/.test(d.getAttribute('style') ?? '')).length;
  return {
    stageCount: flowButtons.length,
    stageNames,
    dotColors,
    hasDetail,
    statsCards,
    title: document.title,
  };
});

console.log('\n=== DOM summary ===');
console.log(JSON.stringify(summary, null, 2));

if (errors.length) {
  console.log('\n=== runtime errors ===');
  for (const e of errors) console.log(`  ${e}`);
}

await browser.close();
