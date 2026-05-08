import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { logOperation } from './op-log.js';

/**
 * Analytics workbench API.
 *
 * The analytics worker pulls T+1 GA4 metrics into `analytics_daily`, and on
 * report runs writes a markdown summary into `agent_runs.output.report`.
 * These endpoints surface that data to the workbench so the agent card stops
 * being a blank tile.
 */
export async function registerAnalyticsAdmin(app: FastifyInstance): Promise<void> {

  // Top N articles by PV in the last `days` days.
  app.get<{ Querystring: { limit?: string; days?: string } }>(
    '/admin/analytics/top',
    async (req) => {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 5)));
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7)));
      const rows = await query<{
        slug: string; title: string; category: string | null;
        pv: number; uv: number; revenue: number;
      }>(
        `SELECT i.slug, i.title, i.category,
                CAST(SUM(a.pv)      AS SIGNED) AS pv,
                CAST(SUM(a.uv)      AS SIGNED) AS uv,
                CAST(SUM(a.revenue) AS DOUBLE) AS revenue
         FROM analytics_daily a
         JOIN items i ON i.id = a.item_id
         WHERE a.date >= CURRENT_DATE - INTERVAL $1 DAY
           AND a.channel = 'site'
         GROUP BY i.id, i.slug, i.title, i.category
         ORDER BY pv DESC
         LIMIT $2`,
        [days, limit],
      );
      return { items: rows, days };
    },
  );

  // Daily PV/UV/revenue trend (one row per day, oldest first for sparkline).
  app.get<{ Querystring: { days?: string } }>(
    '/admin/analytics/daily',
    async (req) => {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7)));
      const rows = await query<{ date: string; pv: number; uv: number; revenue: number }>(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
                CAST(SUM(pv)      AS SIGNED) AS pv,
                CAST(SUM(uv)      AS SIGNED) AS uv,
                CAST(SUM(revenue) AS DOUBLE) AS revenue
         FROM analytics_daily
         WHERE date >= CURRENT_DATE - INTERVAL $1 DAY
           AND channel = 'site'
         GROUP BY date
         ORDER BY date`,
        [days],
      );
      return { daily: rows, days };
    },
  );

  // Latest weekly report. The analytics worker stores either a pull result
  // ({date, upserted, skipped}) or a report ({report: "..."}). We scan recent
  // analytics runs and pick the freshest one whose output carries `report`.
  app.get('/admin/analytics/latest-report', async () => {
    const rows = await query<{ id: string; output: any; finished_at: string | null }>(
      `SELECT id, output, finished_at
       FROM agent_runs
       WHERE agent = 'analytics' AND status = 'success' AND output IS NOT NULL
       ORDER BY finished_at DESC
       LIMIT 10`,
    );
    for (const r of rows) {
      let parsed: any = r.output;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      const report = parsed?.report;
      if (typeof report === 'string') {
        return { report, generatedAt: r.finished_at, runId: r.id };
      }
    }
    return { report: null, generatedAt: null, runId: null };
  });

  // GA4 config probe — lets the UI show a "未配置" warning instead of
  // mysteriously empty tiles.
  app.get('/admin/analytics/ga4-status', async () => {
    const propertyId = !!process.env.GA4_PROPERTY_ID;
    const credentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return { propertyId, credentials, configured: propertyId && credentials };
  });

  // Trigger a weekly-report job. The standard /admin/pipeline/run/analytics
  // route enqueues a `pull` (T+1 GA4 fetch); this is the report twin.
  app.post('/admin/analytics/run-report', async (req) => {
    const jobId = `analytics__report__${Date.now()}`;
    await getQueue(QUEUE_NAMES.analytics).add('analytics', { kind: 'report' }, { jobId });
    await logOperation(req, {
      operation: 'analytics.run-report',
      targetType: 'agent',
      targetId: 'analytics',
      payload: { jobId },
    });
    return { jobId };
  });
}
