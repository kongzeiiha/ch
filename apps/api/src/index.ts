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
const { registerInfra } = await import('./admin-infra.js');
const { registerSourceScoring } = await import('./admin-source-scoring.js');
const { registerClassifyTitle } = await import('./admin-classify-title.js');
const { registerCoverCompliance } = await import('./admin-cover-compliance.js');
const { registerPublishing } = await import('./admin-publishing.js');
const { registerDistribution } = await import('./admin-distribution.js');
const { registerOps } = await import('./admin-ops.js');
const { initSentry, captureException, flushSentry } = await import('./sentry.js');
const { startAlertPoller } = await import('./alerts.js');
const { setupScheduler } = await import('./scheduler.js');
const { registerPipelineAdmin } = await import('./admin-pipeline.js');
const { startAutoPipeline, stopAutoPipeline } = await import('./auto-pipeline.js');
const { registerOpLogHook, registerOpLogAdmin } = await import('./op-log.js');
const { registerFeedbackAdmin } = await import('./admin-feedback.js');
const { registerAdminAuth } = await import('./admin-auth.js');

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
      'classify-title',
      'cover',
      'compliance',
      'publishing',
      'distribution',
      'analytics',
    ],
  }));

  // Operation log hook MUST be registered before any admin routes so the
  // onResponse hook covers them. Catch-all only fires when handlers don't
  // already log explicitly.
  registerOpLogHook(app);
  await registerOpLogAdmin(app);

  // Auth MUST come before all admin route registrations.
  registerAdminAuth(app);

  await registerAdmin(app);
  await registerInfra(app);
  await registerSourceScoring(app);
  await registerClassifyTitle(app);
  await registerCoverCompliance(app);
  await registerPublishing(app);
  await registerDistribution(app);
  await registerOps(app);
  await registerPipelineAdmin(app);
  await registerFeedbackAdmin(app);

  // In production, run workers in a separate process via `start:worker`.
  // Set DISABLE_WORKERS=1 to decouple HTTP from queue processing.
  const workers = process.env.DISABLE_WORKERS !== '1' ? startWorkers() : [];
  if (workers.length) app.log.info(`workers started: ${workers.length}`);

  const alertTimer = startAlertPoller();
  if (process.env.DISABLE_AUTO_PIPELINE !== '1') startAutoPipeline();

  if (process.env.DISABLE_SCHEDULER !== '1') {
    await setupScheduler();
    app.log.info(`scheduler: ingestion fanout cron=${process.env.INGESTION_CRON ?? '0 * * * *'}`);
  }

  await app.listen({ port, host: '::' });

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down...');
    stopAutoPipeline();
    clearInterval(alertTimer);
    await app.close();
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
