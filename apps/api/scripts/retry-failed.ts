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

const QUEUES = ['classification', 'title', 'compliance', 'cover'] as const;

for (const name of QUEUES) {
  const q = getQueue(name as any);
  const failed = await q.getFailed(0, 1000);
  console.log(`${name}: ${failed.length} failed`);
  for (const j of failed) await j.retry('failed');
  console.log(`  → retried`);
}

process.exit(0);
