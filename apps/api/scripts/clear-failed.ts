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
for (const name of Object.values(QUEUE_NAMES) as string[]) {
  const q = getQueue(name as any);
  const ids = await q.clean(0, 10000, 'failed');
  if (ids.length) console.log(`${name}: cleared ${ids.length} failed`);
}
process.exit(0);
