import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from monorepo root (pnpm --filter runs with cwd=<package>).
(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const { closeAll } = await import('@ch/agents');
const { startWorkers } = await import('./workers/index.js');
const { initSentry, flushSentry } = await import('./sentry.js');
const { startAlertPoller } = await import('./alerts.js');
const { setupScheduler } = await import('./scheduler.js');
const { startAutoPipeline, stopAutoPipeline } = await import('./auto-pipeline.js');

async function main(): Promise<void> {
  await initSentry();

  const workers = startWorkers();
  console.info(`[worker] started ${workers.length} workers`);

  const alertTimer = startAlertPoller();
  if (process.env.DISABLE_AUTO_PIPELINE !== '1') startAutoPipeline();

  if (process.env.DISABLE_SCHEDULER !== '1') {
    await setupScheduler();
    console.info(`[worker] scheduler: ingestion cron=${process.env.INGESTION_CRON ?? '0 * * * *'}`);
  }

  const shutdown = async (): Promise<void> => {
    console.info('[worker] shutting down...');
    stopAutoPipeline();
    clearInterval(alertTimer);
    await Promise.all(workers.map((w) => w.close()));
    await closeAll();
    await flushSentry();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
