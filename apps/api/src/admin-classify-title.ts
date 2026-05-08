import type { FastifyInstance } from 'fastify';
import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { revalidatePaths } from './workers/publishing/revalidate.js';

export async function registerClassifyTitle(app: FastifyInstance): Promise<void> {
  // Count items in each pipeline stage. When `category` is passed,
  // `total` and `by_status` scope to that category so the UI can light up
  // accurate per-status counts under an active category filter.
  // `by_category` always returns the full distribution (it's the filter list).
  app.get<{ Querystring: { category?: string } }>('/admin/classify-title/stats', async (req) => {
    const category = req.query.category;
    const catWhere = category ? 'WHERE category = $1' : '';
    const catParams = category ? [category] : [];

    const [total] = await query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM items ${catWhere}`,
      catParams,
    );
    const byStatus = await query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count FROM items ${catWhere}
       GROUP BY status ORDER BY status`,
      catParams,
    );
    const byCategory = await query<{ category: string; count: number }>(
      `SELECT category, COUNT(*) AS count
       FROM items WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC`,
    );
    const runs = await query(
      `SELECT id, agent, status, latency_ms, cost_usd, started_at, finished_at,
              CASE WHEN length(error) > 200 THEN CONCAT(left(error, 200), '…') ELSE error END AS error
       FROM agent_runs
       WHERE agent IN ('classify-title', 'classification', 'title')
       ORDER BY started_at DESC
       LIMIT 20`,
    );
    const [costToday] = await query<{ sum: string | null }>(
      `SELECT CAST(SUM(cost_usd) AS CHAR) AS sum FROM agent_runs
       WHERE started_at > NOW() - INTERVAL 1 DAY
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

  // Items with Day 3 fields populated. Supports filtering by status and/or
  // category — both are AND-combined so the workbench can drill into a single
  // category and then narrow by status (or vice versa).
  app.get<{ Querystring: { limit?: string; status?: string; category?: string } }>(
    '/admin/classify-title/items',
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 30), 200);
      const { status, category } = req.query;
      const params: any[] = [limit];
      const filters: string[] = [];
      if (status) {
        params.push(status);
        filters.push(`i.status = $${params.length}`);
      }
      if (category) {
        params.push(category);
        filters.push(`i.category = $${params.length}`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
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
      `SELECT id FROM items WHERE status = ANY($1::text[])`, [[IS.INGESTED, IS.CLASSIFIED]],
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
      `SELECT id FROM items WHERE status = ANY($1::text[])`, [[IS.INGESTED, IS.CLASSIFIED]],
    );
    const q = getQueue(QUEUE_NAMES.classifyTitle);
    for (const r of rows) {
      await q.add('classify-title', { itemId: r.id }, { jobId: `classify-title__${r.id}` });
    }
    return { enqueued: rows.length };
  });

  // ── Per-item reprocess ─────────────────────────────────────────────────
  // The classify-title worker only acts on INGESTED / CLASSIFIED status; any
  // later state is treated as "pipeline already moved on, skip silently". So
  // a naked enqueue against a downstream item does nothing. Both endpoints
  // below first reset the item to the right starting status (clearing all
  // downstream fields), then enqueue.
  //
  // For PUBLISHED items, this is destructive: the article disappears from
  // the live site until the pipeline runs through to PUBLISHED again. The
  // UI puts a confirm() dialog in front. We also kick ISR so the public
  // page actually 404s instead of serving the cached version.

  interface ResetRow {
    status: string;
    slug: string | null;
    category: string | null;
  }

  async function loadAndRevalidateIfPublished(itemId: string): Promise<ResetRow | null> {
    const rows = await query<ResetRow>(
      `SELECT status, slug, category FROM items WHERE id = $1`,
      [itemId],
    );
    if (!rows.length) return null;
    const item = rows[0];
    // Drop the article from ISR cache so the live site reflects the rollback.
    if (item.status === IS.PUBLISHED && item.slug) {
      const paths = ['/', `/a/${item.slug}`, '/sitemap.xml'];
      if (item.category) paths.push(`/category/${encodeURIComponent(item.category)}`);
      await revalidatePaths(paths);
    }
    return item;
  }

  // Full re-run: clear ALL downstream fields, restart from INGESTED.
  app.post<{ Params: { id: string } }>(
    '/admin/classify-title/reclassify/:id',
    async (req, reply) => {
      const before = await loadAndRevalidateIfPublished(req.params.id);
      if (!before) return reply.code(404).send({ error: 'item not found' });
      await query(
        `UPDATE items
           SET status = $2,
               category = NULL,
               tags = JSON_ARRAY(),
               keywords = JSON_ARRAY(),
               title = NULL,
               summary = NULL,
               slug = NULL,
               cover_url = NULL,
               cover_sizes = NULL,
               cover_copy = NULL,
               compliance_status = NULL,
               risk_tags = JSON_ARRAY(),
               compliance_reasons = NULL,
               published_url = NULL,
               published_at = NULL
         WHERE id = $1`,
        [req.params.id, IS.INGESTED],
      );
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: req.params.id },
        { jobId: `classify-title__${req.params.id}__${Date.now()}` },
      );
      return { ok: true, statusBefore: before.status, statusAfter: IS.INGESTED };
    },
  );

  // Title-only re-run: keep classification, restart from CLASSIFIED clearing
  // title + everything downstream of it.
  app.post<{ Params: { id: string } }>(
    '/admin/classify-title/retitle/:id',
    async (req, reply) => {
      const before = await loadAndRevalidateIfPublished(req.params.id);
      if (!before) return reply.code(404).send({ error: 'item not found' });
      await query(
        `UPDATE items
           SET status = $2,
               title = NULL,
               summary = NULL,
               slug = NULL,
               cover_url = NULL,
               cover_sizes = NULL,
               cover_copy = NULL,
               compliance_status = NULL,
               risk_tags = JSON_ARRAY(),
               compliance_reasons = NULL,
               published_url = NULL,
               published_at = NULL
         WHERE id = $1`,
        [req.params.id, IS.CLASSIFIED],
      );
      await getQueue(QUEUE_NAMES.classifyTitle).add(
        'classify-title',
        { itemId: req.params.id },
        { jobId: `classify-title__${req.params.id}__${Date.now()}` },
      );
      return { ok: true, statusBefore: before.status, statusAfter: IS.CLASSIFIED };
    },
  );
}
