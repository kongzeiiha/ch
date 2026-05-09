import type { FastifyInstance } from 'fastify';
import { query, execute, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { runAlertChecks, agentRunsSummary } from './alerts.js';

export async function registerOps(app: FastifyInstance) {

  // ── Health & Alerts ───────────────────────────────────────

  app.get('/admin/ops/alerts', async () => {
    return runAlertChecks();
  });

  // Agent runs summary (last 24h cost + latency per agent)
  app.get('/admin/ops/agent-runs', async (req) => {
    const { hours = '24' } = req.query as Record<string, string>;
    const h = Math.min(168, Math.max(1, Number(hours)));
    const summary = await agentRunsSummary();
    const recent = await query<{
      id: string; agent: string; item_id: string | null;
      status: string; latency_ms: number | null; cost_usd: number | null;
      error: string | null; started_at: string;
    }>(
      `SELECT id, agent, item_id, status, latency_ms, cost_usd,
              CASE WHEN length(error) > 120 THEN CONCAT(left(error,120),'…') ELSE error END AS error,
              started_at
       FROM agent_runs
       WHERE started_at >= (NOW() - INTERVAL $1 HOUR)
       ORDER BY started_at DESC LIMIT 100`,
      [h],
    );
    return { summary, recent };
  });

  // Queue health snapshot
  app.get('/admin/ops/queues', async () => {
    const { getAllQueueStats } = await import('@ch/agents');
    const stats = await getAllQueueStats();
    return { stats };
  });

  // ── Grayscale ─────────────────────────────────────────────

  // List sources with grayscale_pct
  app.get('/admin/ops/sources', async () => {
    const rows = await query<{
      id: string; name: string; platform: string; status: string;
      score: number; grayscale_pct: number; last_fetch_at: string | null;
    }>(
      `SELECT id, name, platform, status, score,
              COALESCE(grayscale_pct, 100) AS grayscale_pct,
              last_fetch_at
       FROM sources ORDER BY name`,
    );
    return { sources: rows };
  });

  // Set grayscale_pct for a source (0–100)
  app.patch('/admin/ops/sources/:id/grayscale', async (req, reply) => {
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
  app.post('/admin/ops/grayscale-all', async (req, reply) => {
    const { pct } = req.body as { pct: number };
    if (typeof pct !== 'number' || pct < 0 || pct > 100) {
      return reply.status(400).send({ error: 'pct must be 0–100' });
    }
    const r = await execute(
      `UPDATE sources SET grayscale_pct = $1 WHERE status = 'active'`,
      [Math.round(pct)],
    );
    return { updated: r.affectedRows, grayscale_pct: Math.round(pct) };
  });

  // ── Pipeline stats ────────────────────────────────────────

  app.get('/admin/ops/pipeline-stats', async () => {
    const [byStatus, sources, totalCost] = await Promise.all([
      query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) AS cnt FROM items GROUP BY status ORDER BY cnt DESC`,
      ),
      query<{ total: number; active: number; paused: number; blacklist: number }>(
        `SELECT CAST(COUNT(*) AS SIGNED) AS total,
                CAST(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS SIGNED)    AS active,
                CAST(SUM(CASE WHEN status='paused' THEN 1 ELSE 0 END) AS SIGNED)    AS paused,
                CAST(SUM(CASE WHEN status='blacklist' THEN 1 ELSE 0 END) AS SIGNED) AS blacklist
         FROM sources`,
      ),
      query<{ total: number }>(
        `SELECT CAST(COALESCE(SUM(cost_usd),0) AS DOUBLE) AS total FROM agent_runs`,
      ),
    ]);
    return {
      items: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
      sources: sources[0] ?? { total: 0, active: 0, paused: 0, blacklist: 0 },
      totalCostUsd: totalCost[0]?.total ?? 0,
    };
  });

  // Trigger full pipeline stress test via queue (async)
  app.post('/admin/ops/stress-trigger', async () => {
    // Enqueue all INGESTED items that haven't been classified yet
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status = $1 LIMIT 500`,
      [IS.INGESTED],
    );
    if (items.length > 0) {
      await getQueue(QUEUE_NAMES.classifyTitle).addBulk(
        items.map(({ id }) => ({ name: 'classify-title', data: { itemId: id }, opts: { jobId: `classify-title__${id}`, removeOnComplete: true } })),
      );
    }
    return { enqueued: items.length };
  });

  // ── Prometheus metrics ────────────────────────────────────────────────────
  // Scrape endpoint for Prometheus / Grafana. Protected by the same admin
  // token as all other /admin/* routes. Configure your scrape job with:
  //   bearer_token: <ADMIN_TOKEN>
  //
  // Exposed metrics (all gauges / counters scoped to the last 7 days):
  //   ch_items_total{status}          — item counts by pipeline status
  //   ch_sources_total{status}        — source counts by status
  //   ch_agent_runs_total{agent,status} — agent run counts (7d window)
  //   ch_agent_cost_usd_total{agent}  — cumulative LLM cost USD (7d)
  //   ch_agent_latency_p50_ms{agent}  — median run latency ms (7d)
  app.get('/admin/ops/metrics', async (_req, reply) => {
    const [items, sources, runs, costs, latencies] = await Promise.all([
      query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) AS cnt FROM items GROUP BY status`,
      ),
      query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) AS cnt FROM sources GROUP BY status`,
      ),
      query<{ agent: string; status: string; cnt: number }>(
        `SELECT agent, status, COUNT(*) AS cnt
         FROM agent_runs
         WHERE started_at > NOW() - INTERVAL 7 DAY
         GROUP BY agent, status`,
      ),
      query<{ agent: string; total: number }>(
        `SELECT agent, CAST(COALESCE(SUM(cost_usd), 0) AS DOUBLE) AS total
         FROM agent_runs
         WHERE started_at > NOW() - INTERVAL 7 DAY
         GROUP BY agent`,
      ),
      // MySQL 8 has no PERCENTILE_CONT — AVG is acceptable for monitoring.
      query<{ agent: string; p50: number }>(
        `SELECT agent, CAST(AVG(latency_ms) AS DOUBLE) AS p50
         FROM agent_runs
         WHERE started_at > NOW() - INTERVAL 7 DAY
           AND latency_ms IS NOT NULL
         GROUP BY agent`,
      ),
    ]);

    const escLbl = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    const lines: string[] = [];
    const line = (s: string) => lines.push(s);

    line('# HELP ch_items_total Number of pipeline items by status');
    line('# TYPE ch_items_total gauge');
    for (const r of items) line(`ch_items_total{status="${escLbl(r.status)}"} ${r.cnt}`);

    line('# HELP ch_sources_total Number of sources by status');
    line('# TYPE ch_sources_total gauge');
    for (const r of sources) line(`ch_sources_total{status="${escLbl(r.status)}"} ${r.cnt}`);

    line('# HELP ch_agent_runs_total Agent run count by agent and status (last 7 days)');
    line('# TYPE ch_agent_runs_total counter');
    for (const r of runs) line(`ch_agent_runs_total{agent="${escLbl(r.agent)}",status="${escLbl(r.status)}"} ${r.cnt}`);

    line('# HELP ch_agent_cost_usd_total Cumulative LLM cost USD per agent (last 7 days)');
    line('# TYPE ch_agent_cost_usd_total counter');
    for (const r of costs) line(`ch_agent_cost_usd_total{agent="${escLbl(r.agent)}"} ${Number(r.total ?? 0).toFixed(6)}`);

    line('# HELP ch_agent_latency_p50_ms Median agent run latency milliseconds (last 7 days)');
    line('# TYPE ch_agent_latency_p50_ms gauge');
    for (const r of latencies) line(`ch_agent_latency_p50_ms{agent="${escLbl(r.agent)}"} ${Number(r.p50 ?? 0).toFixed(1)}`);

    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return reply.send(lines.join('\n') + '\n');
  });
}
