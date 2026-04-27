import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const { getQueue } = await import('@ch/agents');

const QUEUES = ['ingestion', 'classification', 'title', 'cover'];
for (const name of QUEUES) {
  const q = getQueue(name as any);
  const failed = await q.getFailed(0, 5);
  console.log(`\n=== ${name} (${failed.length} failed shown) ===`);
  for (const j of failed) {
    const reason = (j.failedReason ?? '').split('\n')[0].slice(0, 180);
    console.log(`  ${j.id}: ${reason}`);
  }
}
process.exit(0);
