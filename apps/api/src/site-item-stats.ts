/**
 * 公开的"批量拉文章计数"端点 — 给列表页客户端 mount 后用,patch 上 SSR
 * 时已经过去的计数(浏览 / 点赞 / 评论)。
 *
 *   POST /item-stats
 *   Body: { slugs: string[] }      // 最多 200 个
 *   Resp: {
 *     stats: { [slug]: { likes: number; pv_30d: number; comment_count: number } }
 *   }
 *
 * 不带 admin 鉴权,匿名可调。slugs 全部都得是已发布的 items.slug。
 */
import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';

// items.slug 在 CJK 站点最长 ~200 字符。200×200 = 40KB / 请求,匿名可调,
// 限严一点防被人构造 200 个 512 字符 slug 撑大 SQL ANY 数组。
const MAX_SLUGS = 200;
const MAX_SLUG_LEN = 220;

export function registerSiteItemStats(app: FastifyInstance): void {
  app.post<{ Body: { slugs: string[] } }>('/item-stats', async (req, reply) => {
    const raw = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
    const slugs = raw
      .filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= MAX_SLUG_LEN)
      .slice(0, MAX_SLUGS);
    if (slugs.length === 0) return { stats: {} };

    // 用 ANY($1::text[]) 而不是 IN (?, ?, ...) — @ch/db 把数组展开成占位符,
    // 不用拼字符串,也不用预先 build placeholders。
    const rows = await query<{ slug: string; likes: number; pv_30d: number; comment_count: number }>(
      `SELECT i.slug,
              i.likes,
              -- 跟 feed.ts ARTICLE_COLS 同口径:本站 PV + X 原推查看数
              (i.pv_30d + COALESCE(i.external_views, 0)) AS pv_30d,
              -- 物化列(0026 迁移),写时由 site-comments.ts 和 x-comments worker 维护
              i.comment_count
       FROM items i
       WHERE (i.slug = ANY($1::text[]) OR i.legacy_slug = ANY($1::text[]))
         AND i.status IN ('PUBLISHED','DISTRIBUTED')`,
      [slugs],
    );

    const stats: Record<string, { likes: number; pv_30d: number; comment_count: number }> = {};
    for (const r of rows) {
      stats[r.slug] = {
        likes: Number(r.likes ?? 0),
        pv_30d: Number(r.pv_30d ?? 0),
        comment_count: Number(r.comment_count ?? 0),
      };
    }
    return { stats };
  });
}
