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
const { query } = await import('@ch/db');

const q = getQueue('ingestion' as any);
const failed = await q.getFailed(0, 50);
for (const j of failed) {
  const data = j.data as any;
  const sourceId = data?.sourceId;
  if (sourceId) {
    const rows = await query<{ name: string; url: string; config: any }>(
      `SELECT name, url, config FROM sources WHERE id = $1`, [sourceId]);
    const src = rows[0];
    if (src) {
      console.log(`✗ ${src.name}`);
      console.log(`  feed_url: ${src.config?.feed_url ?? src.url}`);
      console.log(`  reason:   ${(j.failedReason ?? '').split('\n')[0].slice(0, 120)}`);
    }
  } else {
    console.log(`✗ (fanout job, sourceId unknown)`);
  }
}
process.exit(0);
