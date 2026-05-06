import type { FastifyInstance } from 'fastify';
import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';

export async function registerCoverCompliance(app: FastifyInstance): Promise<void> {
  app.get('/admin/cover-compliance/stats', async () => {
    const [total] = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM items`);
    const byStatus = await query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM items GROUP BY status ORDER BY status`,
    );
    const [covered] = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM items WHERE cover_url IS NOT NULL`,
    );
    const complianceBreakdown = await query<{ trigger: string; count: number }>(
      `SELECT (compliance_reasons->>'trigger') AS trigger, COUNT(*)::int AS count
       FROM items WHERE compliance_reasons IS NOT NULL
       GROUP BY trigger ORDER BY count DESC`,
    );
    const runs = await query(
      `SELECT id, agent, status, latency_ms, cost_usd, started_at,
              CASE WHEN length(error) > 180 THEN left(error, 180) || '…' ELSE error END AS error
       FROM agent_runs
       WHERE agent IN ('cover', 'compliance')
       ORDER BY started_at DESC LIMIT 20`,
    );
    const [cost] = await query<{ sum: string | null }>(
      `SELECT SUM(cost_usd)::text AS sum FROM agent_runs
       WHERE started_at > NOW() - interval '1 day'
         AND agent IN ('cover', 'compliance')`,
    );
    return {
      total: total.count,
      by_status: byStatus,
      covered: covered.count,
      compliance_breakdown: complianceBreakdown,
      recent_runs: runs,
      cost_last_24h: Number(cost.sum ?? 0),
    };
  });

  app.get<{ Querystring: { limit?: string; status?: string } }>('/admin/cover-compliance/items', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 30), 200);
    const status = req.query.status;
    const COVER_STATUSES = [IS.TITLED, IS.COVERED, IS.COMPLIANCE_PASS, IS.COMPLIANCE_REVIEW, IS.COMPLIANCE_FAIL];
    // $1 = status array (or single status), $2 = limit
    let where: string;
    let params: unknown[];
    if (status) {
      where = `WHERE i.status = $1`;
      params = [status, limit];
    } else {
      where = `WHERE i.status = ANY($1::text[])`;
      params = [COVER_STATUSES, limit];
    }
    const rows = await query(
      `SELECT i.id, i.status, i.title, i.category, i.cover_url, i.cover_sizes,
              i.cover_copy, i.compliance_status, i.risk_tags, i.compliance_reasons,
              s.name AS source, i.updated_at
       FROM items i JOIN sources s ON s.id = i.source_id
       ${where}
       ORDER BY i.updated_at DESC
       LIMIT $2`,
      params,
    );
    return { items: rows };
  });

  app.post('/admin/cover-compliance/cover-all', async () => {
    const rows = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1`, [IS.TITLED]);
    if (rows.length > 0) {
      await getQueue(QUEUE_NAMES.cover).addBulk(
        rows.map(({ id }) => ({ name: 'render', data: { itemId: id }, opts: { jobId: `cover__${id}` } })),
      );
    }
    return { enqueued: rows.length };
  });

  app.post('/admin/cover-compliance/compliance-all', async () => {
    const rows = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1`, [IS.COVERED]);
    if (rows.length > 0) {
      await getQueue(QUEUE_NAMES.compliance).addBulk(
        rows.map(({ id }) => ({ name: 'check', data: { itemId: id }, opts: { jobId: `compliance__${id}` } })),
      );
    }
    return { enqueued: rows.length };
  });

  app.post<{ Params: { id: string } }>('/admin/cover-compliance/recover/:id', async (req) => {
    await getQueue(QUEUE_NAMES.cover).add(
      'render',
      { itemId: req.params.id },
      { jobId: `cover__${req.params.id}__${Date.now()}` },
    );
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/cover-compliance/recheck/:id', async (req) => {
    await getQueue(QUEUE_NAMES.compliance).add(
      'check',
      { itemId: req.params.id },
      { jobId: `compliance__${req.params.id}__${Date.now()}` },
    );
    return { ok: true };
  });
}
