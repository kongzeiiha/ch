import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { logOperation } from './op-log.js';

export async function registerSourceScoring(app: FastifyInstance): Promise<void> {
  // Sources with their scoring fields surfaced. /admin/sources omits stability
  // and risk_level so the dashboard can't read them — this endpoint adds them.
  app.get('/admin/source-scoring/sources', async () => {
    const rows = await query<{
      id: string; name: string; platform: string; external_id: string;
      status: string; score: number | null; risk_level: string | null;
      stability: number | null; last_fetch_at: string | null;
    }>(
      `SELECT s.id, s.name, s.platform, s.external_id, s.status,
              s.score, s.risk_level, s.stability, s.last_fetch_at
       FROM sources s
       ORDER BY COALESCE(s.score, -1) DESC, s.created_at DESC`,
    );
    return { sources: rows };
  });

  // Aggregate stats for the top of the page (counts + last run summary).
  app.get('/admin/source-scoring/stats', async () => {
    const byStatus = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM sources GROUP BY status`,
    );
    const byRisk = await query<{ risk_level: string | null; cnt: number }>(
      `SELECT risk_level, COUNT(*)::int AS cnt FROM sources GROUP BY risk_level`,
    );
    const [scoreStats] = await query<{ avg: number | null; min: number | null; max: number | null; cnt: number }>(
      `SELECT AVG(score)::float AS avg, MIN(score)::int AS min, MAX(score)::int AS max,
              COUNT(score)::int AS cnt FROM sources WHERE score IS NOT NULL`,
    );
    const [lastRun] = await query<{
      id: string; status: string; started_at: string;
      finished_at: string | null; latency_ms: number | null; output: any;
    }>(
      `SELECT id, status, started_at::text, finished_at::text, latency_ms, output
       FROM agent_runs
       WHERE agent = 'source-scoring'
       ORDER BY started_at DESC LIMIT 1`,
    );
    return {
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
      byRisk: Object.fromEntries(byRisk.map(r => [r.risk_level ?? 'unset', r.cnt])),
      score: scoreStats ?? { avg: null, min: null, max: null, cnt: 0 },
      lastRun: lastRun ?? null,
    };
  });

  // Recent source-scoring runs (each one rescored every active source).
  app.get('/admin/source-scoring/runs', async (req) => {
    const { limit = '10' } = req.query as Record<string, string>;
    const rows = await query(
      `SELECT id, status, started_at::text, finished_at::text,
              latency_ms, output,
              CASE WHEN length(error) > 200 THEN left(error, 200) || '…' ELSE error END AS error
       FROM agent_runs
       WHERE agent = 'source-scoring'
       ORDER BY started_at DESC LIMIT $1`,
      [Math.min(50, Math.max(1, Number(limit)))],
    );
    return { runs: rows };
  });

  // Manual trigger — same job the cron at 03:15 UTC enqueues.
  app.post('/admin/source-scoring/run', async (req) => {
    const q = getQueue(QUEUE_NAMES.sourceScoring);
    await q.add('score', {}, { jobId: `score__manual__${Date.now()}` });
    await logOperation(req, {
      operation: 'source-scoring.run',
      targetType: 'system',
      targetId: null,
    });
    return { queued: 1 };
  });
}
