import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { runAlertChecks, agentRunsSummary } from './alerts.js';

export async function registerDay7(app: FastifyInstance) {

  // ── Health & Alerts ───────────────────────────────────────

  app.get('/admin/day7/alerts', async () => {
    return runAlertChecks();
  });

  // Agent runs summary (last 24h cost + latency per agent)
  app.get('/admin/day7/agent-runs', async (req) => {
    const { hours = '24' } = req.query as Record<string, string>;
    const h = Math.min(168, Math.max(1, Number(hours)));
    const summary = await agentRunsSummary();
    const recent = await query<{
      id: string; agent: string; item_id: string | null;
      status: string; latency_ms: number | null; cost_usd: number | null;
      error: string | null; started_at: string;
    }>(
      `SELECT id, agent, item_id, status, latency_ms, cost_usd,
              CASE WHEN length(error) > 120 THEN left(error,120)||'…' ELSE error END AS error,
              started_at::text
       FROM agent_runs
       WHERE started_at >= NOW() - INTERVAL '${h} hours'
       ORDER BY started_at DESC LIMIT 100`,
    );
    return { summary, recent };
  });

  // Queue health snapshot
  app.get('/admin/day7/queues', async () => {
    const { getAllQueueStats } = await import('@ch/agents');
    const stats = await getAllQueueStats();
    return { stats };
  });

  // ── Grayscale ─────────────────────────────────────────────

  // List sources with grayscale_pct
  app.get('/admin/day7/sources', async () => {
    const rows = await query<{
      id: string; name: string; platform: string; status: string;
      score: number; grayscale_pct: number; last_fetch_at: string | null;
    }>(
      `SELECT id, name, platform, status, score,
              COALESCE(grayscale_pct, 100) AS grayscale_pct,
              last_fetch_at::text
       FROM sources ORDER BY name`,
    );
    return { sources: rows };
  });

  // Set grayscale_pct for a source (0–100)
  app.patch('/admin/day7/sources/:id/grayscale', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { pct } = req.body as { pct: number };
    if (typeof pct !== 'number' || pct < 0 || pct > 100) {
      return reply.status(400).send({ error: 'pct must be 0–100' });
    }
    await query(
      `UPDATE sources SET grayscale_pct = $2 WHERE id = $1`,
      [id, Math.round(pct)],
    );
    return { id, grayscale_pct: Math.round(pct) };
  });

  // Bulk set grayscale_pct for all active sources
  app.post('/admin/day7/grayscale-all', async (req, reply) => {
    const { pct } = req.body as { pct: number };
    if (typeof pct !== 'number' || pct < 0 || pct > 100) {
      return reply.status(400).send({ error: 'pct must be 0–100' });
    }
    const result = await query<{ cnt: number }>(
      `UPDATE sources SET grayscale_pct = $1 WHERE status = 'active'
       RETURNING (SELECT COUNT(*) FROM sources WHERE status = 'active')::int AS cnt`,
      [Math.round(pct)],
    );
    return { updated: result.length, grayscale_pct: Math.round(pct) };
  });

  // ── Pipeline stats ────────────────────────────────────────

  app.get('/admin/day7/pipeline-stats', async () => {
    const [byStatus, sources, totalCost] = await Promise.all([
      query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*)::int AS cnt FROM items GROUP BY status ORDER BY cnt DESC`,
      ),
      query<{ total: number; active: number; paused: number; blacklist: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='active')::int     AS active,
                COUNT(*) FILTER (WHERE status='paused')::int     AS paused,
                COUNT(*) FILTER (WHERE status='blacklist')::int  AS blacklist
         FROM sources`,
      ),
      query<{ total: number }>(
        `SELECT COALESCE(SUM(cost_usd),0)::float AS total FROM agent_runs`,
      ),
    ]);
    return {
      items: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
      sources: sources[0] ?? { total: 0, active: 0, paused: 0, blacklist: 0 },
      totalCostUsd: totalCost[0]?.total ?? 0,
    };
  });

  // Trigger full pipeline stress test via queue (async)
  app.post('/admin/day7/stress-trigger', async () => {
    // Enqueue all INGESTED items that haven't been classified yet
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status = 'INGESTED' LIMIT 500`,
    );
    const q = getQueue(QUEUE_NAMES.classification);
    let enqueued = 0;
    for (const { id } of items) {
      await q.add('classify', { itemId: id }, { jobId: `classify__${id}` });
      enqueued++;
    }
    return { enqueued };
  });
}
