import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { logOperation } from './op-log.js';

export async function registerPublishing(app: FastifyInstance) {
  // Published article stats
  app.get('/admin/publishing/stats', async () => {
    const [totals, recent] = await Promise.all([
      query<{ status: string; cnt: string }>(
        `SELECT status, COUNT(*)::text AS cnt FROM items GROUP BY status ORDER BY cnt DESC`,
      ),
      query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM items
         WHERE status = 'PUBLISHED' AND published_at >= NOW() - INTERVAL '24 hours'`,
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of totals) byStatus[r.status] = Number(r.cnt);

    return {
      byStatus,
      publishedLast24h: Number(recent[0]?.cnt ?? 0),
    };
  });

  // List published items (newest first)
  app.get('/admin/publishing/items', async (req) => {
    const { limit = '20', offset = '0' } = req.query as Record<string, string>;
    const rows = await query<{
      id: string;
      slug: string;
      title: string;
      category: string | null;
      published_at: string | null;
      published_url: string | null;
    }>(
      `SELECT id, slug, title, category, published_at, published_url
       FROM items WHERE status = 'PUBLISHED'
       ORDER BY published_at DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(100, Number(limit)), Number(offset)],
    );
    return { items: rows };
  });

  // Force-publish a single item (bypasses compliance gate)
  app.post('/admin/publishing/force-publish/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM items WHERE id = $1`,
      [id],
    );
    if (!rows.length) return reply.status(404).send({ error: 'not found' });

    const q = getQueue(QUEUE_NAMES.publishing);
    await q.add('publish', { itemId: id, force: true }, { jobId: `publish__force__${id}` });
    await logOperation(req, {
      operation: 'publish.force',
      targetType: 'item',
      targetId: id,
      payload: { fromStatus: rows[0].status, bypassCompliance: true },
    });
    return { queued: id };
  });

  // Publish all items that passed compliance (or have a title in non-strict mode)
  app.post('/admin/publishing/publish-all', async (req) => {
    const candidates = await query<{ id: string }>(
      `SELECT id FROM items
       WHERE status IN ('COMPLIANCE_PASS', 'COMPLIANCE_REVIEW')
         AND slug IS NOT NULL
       ORDER BY published_at DESC NULLS LAST
       LIMIT 200`,
    );
    const q = getQueue(QUEUE_NAMES.publishing);
    let queued = 0;
    const queuedIds: string[] = [];
    for (const { id } of candidates) {
      await q.add('publish', { itemId: id }, { jobId: `publish__${id}` });
      queuedIds.push(id);
      queued++;
    }
    await logOperation(req, {
      operation: 'publish.batch',
      targetType: 'system',
      targetId: null,
      payload: { count: queued, itemIds: queuedIds },
    });
    return { queued };
  });

  // Trigger a single full source-scoring run now
  app.post('/admin/publishing/score-now', async (req) => {
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
