/**
 * 自建点赞端点 — 不依赖第三方。
 *
 *   POST   /like/:slug      点赞   (幂等:同指纹再点不重复+1)
 *   DELETE /like/:slug      取消点赞 (幂等:没点过不会变负数)
 *   GET    /likes/:slug     读取计数 + 当前指纹是否点过
 *
 * 反作弊:
 *   - Redis 存指纹→item_id 的"已点过"标记,30 天 TTL
 *   - Bot UA 过滤 + slug 真实性校验
 *   - items.likes 用 GREATEST(0, likes - 1) 防 unlike 把计数压成负数
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { query, execute } from '@ch/db';
import { getRedis } from '@ch/agents';

const BOT_RE = /bot|spider|crawl|slurp|fetch|monitor|preview|headless|wget|curl/i;
const LIKE_TTL_SEC = 30 * 24 * 3600;  // 30 天:够长,避免用户反复刷点赞;不无限是为给清算留余地

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function fingerprint(req: { headers: Record<string, unknown>; ip?: string }): string {
  const ua = String(req.headers['user-agent'] ?? '');
  const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0]!.trim();
  return hash(`${ip}|${ua}`);
}

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

export function registerSiteLikes(app: FastifyInstance): void {
  // ── POST /like/:slug ─────────────────────────────────────────────────
  app.post<{ Params: { slug: string } }>('/like/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOT_RE.test(ua)) return { ok: false, reason: 'bot', likes: 0, liked: false };

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const fp = fingerprint(req as any);
    const key = `like:${item.id}:${fp}`;

    // 已点过 → 直接返回,不重复 +1
    const r = await getRedis().set(key, '1', 'EX', LIKE_TTL_SEC, 'NX');
    if (r !== 'OK') {
      const [row] = await query<{ likes: number }>(`SELECT likes FROM items WHERE id = $1`, [item.id]);
      return { ok: true, likes: row?.likes ?? 0, liked: true, deduped: true };
    }

    await execute(`UPDATE items SET likes = likes + 1 WHERE id = $1`, [item.id]);
    const [row] = await query<{ likes: number }>(`SELECT likes FROM items WHERE id = $1`, [item.id]);
    // 列表层缓存已禁用(HOT_TTL=0),不需要再 flush。客户端 LiveCountPatcher
    // 会在 mount / visibility / pageshow 时主动拉 /api/item-stats 同步数字。
    return { ok: true, likes: row?.likes ?? 0, liked: true };
  });

  // ── DELETE /like/:slug — 取消点赞 ─────────────────────────────────────
  app.delete<{ Params: { slug: string } }>('/like/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const fp = fingerprint(req as any);
    const key = `like:${item.id}:${fp}`;
    const removed = await getRedis().del(key);

    // 只在指纹之前确实存在标记时才减 — 避免重复取消把计数搞到负数
    if (removed > 0) {
      await execute(`UPDATE items SET likes = GREATEST(0, likes - 1) WHERE id = $1`, [item.id]);
    }

    const [row] = await query<{ likes: number }>(`SELECT likes FROM items WHERE id = $1`, [item.id]);
    return { ok: true, likes: row?.likes ?? 0, liked: false };
  });

  // ── GET /likes/:slug — 读取计数 + 当前指纹是否已点 ────────────────────
  app.get<{ Params: { slug: string } }>('/likes/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const fp = fingerprint(req as any);
    const [row] = await query<{ likes: number }>(`SELECT likes FROM items WHERE id = $1`, [item.id]);
    const liked = (await getRedis().exists(`like:${item.id}:${fp}`)) > 0;

    return { ok: true, likes: row?.likes ?? 0, liked };
  });
}
