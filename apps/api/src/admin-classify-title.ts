import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';

export async function registerClassifyTitle(app: FastifyInstance): Promise<void> {
  // Count items in each pipeline stage
  app.get('/admin/classify-title/stats', async () => {
    const [total] = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM items`,
    );
    const byStatus = await query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM items GROUP BY status ORDER BY status`,
    );
    const byCategory = await query<{ category: string; count: number }>(
      `SELECT category, COUNT(*)::int AS count
       FROM items WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC`,
    );
    const runs = await query(
      `SELECT id, agent, status, latency_ms, cost_usd, started_at, finished_at,
              CASE WHEN length(error) > 200 THEN left(error, 200) || '…' ELSE error END AS error
       FROM agent_runs
       WHERE agent IN ('classify-title', 'classification', 'title')
       ORDER BY started_at DESC
       LIMIT 20`,
    );
    const [costToday] = await query<{ sum: string | null }>(
      `SELECT SUM(cost_usd)::text AS sum FROM agent_runs
       WHERE started_at > NOW() - interval '1 day'
         AND agent IN ('classify-title', 'classification', 'title')`,
    );

    return {
      total: total.count,
      by_status: byStatus,
      by_category: byCategory,
      recent_runs: runs,
      cost_last_24h: Number(costToday.sum ?? 0),
    };
  });

  // Items with Day 3 fields populated
  app.get<{ Querystring: { limit?: string; status?: string } }>(
    '/admin/classify-title/items',
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 30), 200);
      const status = req.query.status;
      const params: any[] = [limit];
      let where = '';
      if (status) {
        params.push(status);
        where = `WHERE i.status = $2`;
      }
      const rows = await query(
        `SELECT i.id, i.status, i.title, i.summary, i.slug, i.category, i.tags, i.keywords,
                s.name AS source, r.url, i.updated_at
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN raw_items r ON r.id = i.raw_item_id
         ${where}
         ORDER BY i.updated_at DESC
         LIMIT $1`,
        params,
      );
      return { items: rows };
    },
  );

  // Enqueue classify-title for all INGESTED or backlog CLASSIFIED items
  app.post('/admin/classify-title/classify-all', async () => {
    const rows = await query<{ id: string }>(
      `SELECT id FROM items WHERE status IN ('INGESTED', 'CLASSIFIED')`,
    );
    const q = getQueue(QUEUE_NAMES.classifyTitle);
    for (const r of rows) {
      await q.add('classify-title', { itemId: r.id }, { jobId: `classify-title__${r.id}` });
    }
    return { enqueued: rows.length };
  });

  // Alias for title-all — same handler as classify-all (the classify worker now
  // generates the title in the same pass, so both endpoints just enqueue the
  // INGESTED + CLASSIFIED set).
  app.post('/admin/classify-title/title-all', async () => {
    const rows = await query<{ id: string }>(
      `SELECT id FROM items WHERE status IN ('INGESTED', 'CLASSIFIED')`,
    );
    const q = getQueue(QUEUE_NAMES.classifyTitle);
    for (const r of rows) {
      await q.add('classify-title', { itemId: r.id }, { jobId: `classify-title__${r.id}` });
    }
    return { enqueued: rows.length };
  });

  // Per-item reprocess — handy for debugging one article
  app.post<{ Params: { id: string } }>(
    '/admin/classify-title/reclassify/:id',
    async (req) => {
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: req.params.id },
        { jobId: `classify-title__${req.params.id}__${Date.now()}` },
      );
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/classify-title/retitle/:id',
    async (req) => {
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: req.params.id },
        { jobId: `classify-title__${req.params.id}__${Date.now()}` },
      );
      return { ok: true };
    },
  );
}
