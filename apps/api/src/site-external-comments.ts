/**
 * 公开端点:返回某篇文章关联的 X 平台同步评论。
 *
 *   GET /external-comments/:slug   读最近 50 条同步过的 X 评论 + 总数
 *
 * 数据来自 x-comments worker(10 分钟一轮)同步进 external_comments 表。
 * 站点匿名评论走另一张 comments 表,/comments/:slug 仍然独立。文章页分两区渲染。
 */
import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';

const FETCH_LIMIT = 50;

async function resolveItem(slug: string): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM items
     WHERE (slug = $1 OR legacy_slug = $1)
       AND status IN ('PUBLISHED','DISTRIBUTED')
     LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export function registerSiteExternalComments(app: FastifyInstance): void {
  app.get<{ Params: { slug: string } }>('/external-comments/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const [rows, totalRows] = await Promise.all([
      query<{
        id: number;
        platform: string;
        external_id: string;
        author_handle: string;
        author_name: string | null;
        author_avatar: string | null;
        body: string;
        posted_at: string;
      }>(
        `SELECT id, platform, external_id, author_handle, author_name, author_avatar, body, posted_at
         FROM external_comments WHERE item_id = $1
         ORDER BY posted_at DESC LIMIT $2`,
        [item.id, FETCH_LIMIT],
      ),
      query<{ n: number }>(`SELECT COUNT(*) AS n FROM external_comments WHERE item_id = $1`, [item.id]),
    ]);

    return {
      ok: true,
      comments: rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        externalId: r.external_id,
        authorHandle: r.author_handle,
        authorName: r.author_name,
        authorAvatar: r.author_avatar,
        body: r.body,
        postedAt: r.posted_at,
      })),
      total: Number(totalRows[0]?.n ?? 0),
    };
  });
}
