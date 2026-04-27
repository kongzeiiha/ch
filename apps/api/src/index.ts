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

const Fastify = (await import('fastify')).default;
const fastifyCors = (await import('@fastify/cors')).default;
const { query } = await import('@ch/db');
const { closeAll } = await import('@ch/agents');
const { startWorkers } = await import('./workers/index.js');
const { registerAdmin } = await import('./admin.js');
const { registerDay1 } = await import('./admin-day1.js');
const { registerDay3 } = await import('./admin-day3.js');
const { registerDay4 } = await import('./admin-day4.js');
const { registerDay5 } = await import('./admin-day5.js');
const { registerDay6 } = await import('./admin-day6.js');
const { registerDay7 } = await import('./admin-day7.js');
const { initSentry, captureException } = await import('./sentry.js');
const { startAlertPoller } = await import('./alerts.js');
const { setupScheduler } = await import('./scheduler.js');
const { registerPipelineAdmin } = await import('./admin-pipeline.js');
const { startAutoPipeline, stopAutoPipeline } = await import('./auto-pipeline.js');

const port = Number(process.env.API_PORT ?? 4000);

async function main(): Promise<void> {
  await initSentry();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(fastifyCors, {
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global error hook — forward unhandled Fastify errors to Sentry
  app.setErrorHandler((err, _req, reply) => {
    captureException(err, { route: _req.routerPath });
    reply.status(err.statusCode ?? 500).send({ error: err.message });
  });

  app.get('/health', async () => {
    const rows = await query<{ ok: number }>('SELECT 1 AS ok');
    return { ok: rows[0]?.ok === 1, ts: Date.now() };
  });

  app.get('/agents', async () => ({
    agents: [
      'source-scoring',
      'ingestion',
      'classification',
      'title',
      'cover',
      'compliance',
      'publishing',
      'distribution',
      'analytics',
    ],
  }));

  await registerAdmin(app);
  await registerDay1(app);
  await registerDay3(app);
  await registerDay4(app);
  await registerDay5(app);
  await registerDay6(app);
  await registerDay7(app);
  await registerPipelineAdmin(app);

  const workers = startWorkers();
  app.log.info(`workers started: ${workers.length}`);

  startAlertPoller();
  if (process.env.DISABLE_AUTO_PIPELINE !== '1') startAutoPipeline();

  if (process.env.DISABLE_SCHEDULER !== '1') {
    await setupScheduler();
    app.log.info(`scheduler: ingestion fanout cron=${process.env.INGESTION_CRON ?? '0 * * * *'}`);
  }

  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down...');
    stopAutoPipeline();
    await app.close();
    await Promise.all(workers.map((w) => w.close()));
    await closeAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
