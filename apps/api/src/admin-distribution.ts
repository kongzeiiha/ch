import type { FastifyInstance } from 'fastify';
import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { generateWeeklyReport } from './workers/analytics/report.js';
import { logOperation } from './op-log.js';

export async function registerDistribution(app: FastifyInstance) {
  // ── Distribution ──────────────────────────────────────────

  // List distribution tasks (newest first)
  app.get('/admin/distribution/distribution', async (req) => {
    const { limit = '50', offset = '0' } = req.query as Record<string, string>;
    const rows = await query<{
      id: string;
      item_id: string;
      channel: string;
      copy: string;
      status: string;
      created_at: string;
      title: string;
      slug: string | null;
    }>(
      `SELECT dt.id, dt.item_id, dt.channel, dt.copy, dt.status, dt.created_at::text,
              i.title, i.slug
       FROM distribution_tasks dt
       JOIN items i ON i.id = dt.item_id
       ORDER BY dt.created_at DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(200, Number(limit)), Number(offset)],
    );
    return { tasks: rows };
  });

  // Distribution stats
  app.get('/admin/distribution/distribution-stats', async () => {
    const [byStatus, byChannel, pending] = await Promise.all([
      query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*)::int AS cnt FROM distribution_tasks GROUP BY status`,
      ),
      query<{ channel: string; cnt: number }>(
        `SELECT channel, COUNT(*)::int AS cnt FROM distribution_tasks GROUP BY channel`,
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM items
         WHERE status = $1
           AND id NOT IN (SELECT DISTINCT item_id FROM distribution_tasks WHERE channel = 'twitter')`,
        [IS.PUBLISHED],
      ),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
      byChannel: Object.fromEntries(byChannel.map((r) => [r.channel, r.cnt])),
      pendingDistribution: pending[0]?.cnt ?? 0,
    };
  });

  // Queue distribution for one item
  app.post('/admin/distribution/distribute/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { channel = 'twitter' } = req.query as { channel?: string };
    const rows = await query<{ id: string }>(
      `SELECT id FROM items WHERE id = $1 AND status = ANY($2::text[])`,
      [id, [IS.PUBLISHED, IS.DISTRIBUTED]],
    );
    if (!rows.length) return reply.status(404).send({ error: 'item not found or not published' });
    const q = getQueue(QUEUE_NAMES.distribution);
    await q.add('distribute', { itemId: id, channel }, { jobId: `dist__${channel}__${id}` });
    await logOperation(req, {
      operation: 'distribution.queue',
      targetType: 'item',
      targetId: id,
      payload: { channel },
    });
    return { queued: id, channel };
  });

  // Queue distribution for all published items not yet distributed on twitter
  app.post('/admin/distribution/distribute-all', async (req) => {
    const candidates = await query<{ id: string }>(
      `SELECT id FROM items
       WHERE status = $1
         AND id NOT IN (SELECT DISTINCT item_id FROM distribution_tasks WHERE channel = 'twitter')
       ORDER BY published_at DESC
       LIMIT 100`,
      [IS.PUBLISHED],
    );
    const q = getQueue(QUEUE_NAMES.distribution);
    let queued = 0;
    const queuedIds: string[] = [];
    for (const { id } of candidates) {
      await q.add('distribute', { itemId: id, channel: 'twitter' }, { jobId: `dist__twitter__${id}` });
      queuedIds.push(id);
      queued++;
    }
    await logOperation(req, {
      operation: 'distribution.batch-queue',
      targetType: 'system',
      targetId: null,
      payload: { channel: 'twitter', count: queued, itemIds: queuedIds },
    });
    return { queued };
  });

  // Edit a distribution task's copy before it's actually posted. The distribution
  // agent generates an initial draft; operators routinely tweak the wording or
  // hashtags before confirming. Only mutable while status='pending' — once
  // confirmed/done the row is frozen for audit.
  app.patch<{ Params: { taskId: string }; Body: { copy: string } }>(
    '/admin/distribution/distribution-tasks/:taskId',
    async (req, reply) => {
      const { taskId } = req.params;
      const { copy } = req.body ?? ({} as { copy: string });
      if (typeof copy !== 'string' || copy.trim().length === 0) {
        return reply.status(400).send({ error: 'copy 不能为空' });
      }
      if (copy.length > 2000) {
        return reply.status(400).send({ error: 'copy 超过 2000 字符上限' });
      }
      // Capture the previous text so the audit log holds before/after.
      const before = await query<{ id: string; copy: string; status: string; channel: string; item_id: string }>(
        `SELECT id, copy, status, channel, item_id FROM distribution_tasks WHERE id = $1`,
        [taskId],
      );
      if (!before.length) return reply.status(404).send({ error: 'task not found' });
      if (before[0].status !== 'pending') {
        return reply.status(409).send({ error: `task is ${before[0].status}, only pending copy is editable` });
      }
      const after = await query<{ id: string; copy: string }>(
        `UPDATE distribution_tasks SET copy = $2 WHERE id = $1 RETURNING id, copy`,
        [taskId, copy],
      );
      await logOperation(req, {
        operation: 'distribution.edit-copy',
        targetType: 'distribution_task',
        targetId: taskId,
        payload: {
          itemId: before[0].item_id,
          channel: before[0].channel,
          before: before[0].copy,
          after: copy,
        },
      });
      return { task: after[0] };
    },
  );

  // ── Analytics ─────────────────────────────────────────────

  // Analytics summary (last 7 days)
  app.get('/admin/distribution/analytics', async () => {
    const [daily, topItems, summary] = await Promise.all([
      query<{ date: string; pv: number; uv: number; revenue: number }>(
        `SELECT date::text, SUM(pv)::int AS pv, SUM(uv)::int AS uv,
                SUM(revenue)::float AS revenue
         FROM analytics_daily
         WHERE date >= CURRENT_DATE - 7
         GROUP BY date ORDER BY date DESC`,
      ),
      query<{ title: string; slug: string | null; pv: number; uv: number; revenue: number }>(
        `SELECT i.title, i.slug,
                SUM(a.pv)::int AS pv, SUM(a.uv)::int AS uv,
                SUM(a.revenue)::float AS revenue
         FROM analytics_daily a
         JOIN items i ON i.id = a.item_id
         WHERE a.date >= CURRENT_DATE - 7
         GROUP BY i.id, i.title, i.slug
         ORDER BY pv DESC LIMIT 10`,
      ),
      query<{ total_pv: number; total_uv: number; total_revenue: number }>(
        `SELECT COALESCE(SUM(pv),0)::int AS total_pv,
                COALESCE(SUM(uv),0)::int AS total_uv,
                COALESCE(SUM(revenue),0)::float AS total_revenue
         FROM analytics_daily WHERE date >= CURRENT_DATE - 7`,
      ),
    ]);
    return { daily, topItems, summary: summary[0] ?? { total_pv: 0, total_uv: 0, total_revenue: 0 } };
  });

  // Trigger GA4 pull for yesterday
  app.post('/admin/distribution/analytics-pull', async (req) => {
    const q = getQueue(QUEUE_NAMES.analytics);
    await q.add('analytics', { kind: 'pull' }, { jobId: `analytics__pull__${Date.now()}` });
    await logOperation(req, { operation: 'analytics.pull', targetType: 'system' });
    return { queued: true };
  });

  // Generate weekly markdown report inline (no queue)
  app.get('/admin/distribution/report', async () => {
    const markdown = await generateWeeklyReport();
    return { markdown };
  });
}
