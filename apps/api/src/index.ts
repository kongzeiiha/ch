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
const fastifyMultipart = (await import('@fastify/multipart')).default;
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
const { registerAnalyticsAdmin } = await import('./admin-analytics.js');
const { startHarvestPoller } = await import('./training-data.js');
const { deriveRulesFromExamples } = await import('./derive-rules.js');
const { registerAdminAuth } = await import('./admin-auth.js');
const { registerMediaProxy } = await import('./media-proxy.js');
const { registerSiteAnalytics } = await import('./site-analytics.js');
const { registerSiteLikes } = await import('./site-likes.js');
const { registerSiteComments } = await import('./site-comments.js');
const { registerSiteExternalComments } = await import('./site-external-comments.js');
const { registerSiteItemStats } = await import('./site-item-stats.js');
const { registerManualPost } = await import('./admin-manual-post.js');

const port = Number(process.env.API_PORT ?? 4000);

async function main(): Promise<void> {
  await initSentry();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(fastifyCors, {
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // 手工发帖 / 后台批量导入 都通过 multipart 上传文件,单文件 50MB 上限。
  // attachFieldsToBody=false:文件用 req.parts() 拿,字段用 req.body 取。
  await app.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
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

  // Auth MUST come before all admin route registrations. Public media proxies
  // sit outside /admin/* so the auth hook ignores them.
  registerAdminAuth(app);
  await registerMediaProxy(app);
  // 公开 PV 埋点(POST /pv/:slug),路径不带 /admin 所以不会被 admin auth 拦截。
  registerSiteAnalytics(app);
  // 公开点赞端点(/like/:slug、/likes/:slug)。和 PV 同样不走 admin auth。
  registerSiteLikes(app);
  // 公开评论端点 — 匿名 LS 身份,Redis 指纹 rate-limit。
  registerSiteComments(app);
  // 外部平台评论(X 同步)— 文章页另一区展示。
  registerSiteExternalComments(app);
  // 批量计数:列表客户端 mount 后用它把卡片数字 patch 到最新。
  registerSiteItemStats(app);

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
  await registerAnalyticsAdmin(app);
  registerManualPost(app);

  // Sweep zombie agent_runs left behind by a previous process death. `withRun`
  // does INSERT 'running' → run fn → UPDATE 'success/failed' with no `finally`,
  // so a pm2 restart / OOM / SIGKILL between those steps leaves the row stuck
  // forever. 5 minutes is well above the longest real LLM agent (compliance
  // is the slowest ≈ 60s), so anything older is provably abandoned.
  {
    const { query } = await import('@ch/db');
    const swept = await query<{ n: number }>(
      `UPDATE agent_runs SET status='failed',
         error='zombie: process died before job finished',
         finished_at=NOW(),
         latency_ms=TIMESTAMPDIFF(MILLISECOND, started_at, NOW())
       WHERE status='running' AND started_at < NOW() - INTERVAL 5 MINUTE`,
    ).catch(() => [{ n: 0 }]);
    void swept; // mysql2 UPDATE doesn't return affectedRows via query<T>; cosmetic only.
    app.log.info('[boot] zombie agent_runs sweep done');
  }

  // In production, run workers in a separate process via `start:worker`.
  // Set DISABLE_WORKERS=1 to decouple HTTP from queue processing.
  const workers = process.env.DISABLE_WORKERS !== '1' ? startWorkers() : [];
  if (workers.length) app.log.info(`workers started: ${workers.length}`);

  const alertTimer = startAlertPoller();
  const harvestTimer = startHarvestPoller();

  // 自建 PV 埋点写入 analytics_daily 之后,items.pv_30d 需要刷新才能让"最热"
  // 排序看见新数据。每小时跑一次就够 — recomputePv30d 是单条 UPDATE JOIN,廉价。
  // 配 DISABLE_PV_RECOMPUTE=1 可关闭(比如 worker 进程已经在跑,避免双写)。
  let pvRecomputeTimer: NodeJS.Timeout | null = null;
  if (process.env.DISABLE_PV_RECOMPUTE !== '1') {
    const { refreshPv30d } = await import('./workers/analytics/ga4.js');
    const runRefresh = async () => {
      try { await refreshPv30d(); }
      catch (e: any) { console.warn('[pv-recompute]', e?.message ?? e); }
    };
    // 启动后等 1 分钟再首次跑(让其他初始化先完成),之后每小时一次
    pvRecomputeTimer = setInterval(runRefresh, 3600_000);
    setTimeout(runRefresh, 60_000);
  }

  // Weekly derive-rules: waits 1h after boot so the first run doesn't compete
  // with startup traffic, then fires every DERIVE_RULES_INTERVAL_MS (7 days).
  if (process.env.DISABLE_DERIVE_RULES !== '1') {
    const deriveInterval = Number(process.env.DERIVE_RULES_INTERVAL_MS ?? 7 * 24 * 3600_000);
    let deriveTimer: NodeJS.Timeout;
    const runDerive = async () => {
      for (const domain of ['compliance', 'distribution'] as const) {
        try {
          const r = await deriveRulesFromExamples(domain);
          if (r.rulesCreated > 0) {
            console.info(`[derive-rules] ${domain}: +${r.rulesCreated} rules from ${r.examplesRead} examples`);
          }
        } catch (e: any) {
          console.warn(`[derive-rules] ${domain}:`, e?.message ?? e);
        }
      }
      deriveTimer = setTimeout(runDerive, deriveInterval);
    };
    setTimeout(runDerive, Math.min(3600_000, deriveInterval));
    app.addHook('onClose', async () => clearTimeout(deriveTimer));
  }

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
    clearInterval(harvestTimer);
    if (pvRecomputeTimer) clearInterval(pvRecomputeTimer);
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
