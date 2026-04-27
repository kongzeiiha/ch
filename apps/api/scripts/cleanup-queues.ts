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

const { getQueue, QUEUE_NAMES } = await import('@ch/agents');

const ALL = Object.values(QUEUE_NAMES) as string[];
for (const name of ALL) {
  const q = getQueue(name as any);
  const counts = await q.getJobCounts('waiting','active','delayed','failed','completed');
  console.log(name, counts);
  await q.obliterate({ force: true });
  console.log(`  → obliterated`);
}
process.exit(0);
