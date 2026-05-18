/**
 * 「我关注的」公开 feed 端点。
 *
 *   POST /following/feed
 *   Body: { sourceIds: string[], limit?: number, offset?: number }
 *   Resp: { items: ArticleCardRow[], total }
 *
 * 没有用户系统,关注列表在浏览器 localStorage 里,所以这里只是一个无状态
 * 的"多 source 过滤"接口 — 客户端把 ID 列表传过来,后端就给 items。
 *
 * 安全考虑:
 *   - 最多 500 个 sourceId(普通人关注上限),避免单个请求构造巨型 IN 子句
 *   - UUID 格式校验,挡掉 SQL 注入尝试(且 prepared param 是兜底)
 *   - 不带 admin 鉴权,匿名可调
 */
import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerSiteFollowing(app: FastifyInstance): void {
  app.post<{
    Body: { sourceIds: string[]; limit?: number; offset?: number };
  }>('/following/feed', async (req, reply) => {
    const raw = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];
    const ids = raw.filter((x) => typeof x === 'string' && UUID_RE.test(x)).slice(0, 500);
    if (ids.length === 0) return { items: [], total: 0 };

    const limit = Math.min(Math.max(Number(req.body?.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.body?.offset ?? 0), 0);

    // 构造 IN (?,?,?...) 占位符列表。mysql2 / @ch/db rebuild() 会把 $N 翻成 ?,
    // 这里手写 placeholder 列表是为了多参数 IN 子句。
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const [items, totalRows] = await Promise.all([
      query(
        `SELECT i.id, i.slug, i.title, i.summary, i.source_id,
                i.cover_url, i.cover_sizes, i.category, i.tags,
                i.published_at, i.duration_sec, i.pv_30d, i.likes,
                s.name AS source, s.platform AS source_platform,
                JSON_UNQUOTE(JSON_EXTRACT(r.media_urls, '$[0]')) AS cover_fallback,
                JSON_UNQUOTE(JSON_EXTRACT(r.video_urls, '$[0]')) AS video_url,
                (JSON_LENGTH(r.video_urls) > 0) AS has_video,
                (JSON_LENGTH(r.media_urls) > 0) AS has_image,
                COALESCE(CHAR_LENGTH(i.content), 0) AS content_length
         FROM items i
         JOIN sources s ON s.id = i.source_id
         LEFT JOIN raw_items r ON r.id = i.raw_item_id
         WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
           AND i.source_id IN (${placeholders})
         ORDER BY i.published_at DESC
         LIMIT $${ids.length + 1} OFFSET $${ids.length + 2}`,
        [...ids, limit, offset],
      ),
      query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM items i
         WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
           AND i.source_id IN (${placeholders})`,
        ids,
      ),
    ]);

    return { items, total: Number(totalRows[0]?.n ?? 0) };
  });
}
