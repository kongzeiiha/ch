/**
 * 公开评论端点 — 站点无用户系统,评论走匿名 LS 身份(display_name + anon_id)。
 *
 *   GET  /comments/:slug   读最新 50 条评论 + 总数
 *   POST /comment/:slug    发评论 (body: { name, body, anonId })
 *
 * 反作弊:
 *   - Bot UA 直接 403
 *   - IP+UA 指纹做 Redis 30s rate-limit,挡掉脚本灌水
 *   - body 1..2000,name <=32(空 → "匿名")
 *   - slug 必须命中 items.PUBLISHED/DISTRIBUTED,否则 404
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { query, execute } from '@ch/db';
import { getRedis } from '@ch/agents';

const BOT_RE = /bot|spider|crawl|slurp|fetch|monitor|preview|headless|wget|curl/i;
const RL_WINDOW_SEC = 30;     // 同指纹每 30s 限 1 条
const FETCH_LIMIT = 50;

function fingerprint(req: { headers: Record<string, unknown>; ip?: string }): string {
  const ua = String(req.headers['user-agent'] ?? '');
  const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0]!.trim();
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
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

export function registerSiteComments(app: FastifyInstance): void {
  // ── GET /comments/:slug ─────────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/comments/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    const [rows, totalRows] = await Promise.all([
      query<{
        id: number; anon_id: string; display_name: string; body: string; created_at: string;
      }>(
        `SELECT id, anon_id, display_name, body, created_at
         FROM comments WHERE item_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [item.id, FETCH_LIMIT],
      ),
      query<{ n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE item_id = $1`, [item.id]),
    ]);

    return {
      ok: true,
      comments: rows.map((r) => ({
        id: r.id, anonId: r.anon_id, name: r.display_name, body: r.body, createdAt: r.created_at,
      })),
      total: Number(totalRows[0]?.n ?? 0),
    };
  });

  // ── POST /comment/:slug ─────────────────────────────────────────────────
  app.post<{
    Params: { slug: string };
    Body: { name?: string; body: string; anonId: string };
  }>('/comment/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOT_RE.test(ua)) return reply.code(403).send({ error: 'bot detected' });

    const b = req.body ?? ({} as any);
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (body.length < 1) return reply.code(400).send({ error: '评论不能为空' });
    if (body.length > 2000) return reply.code(400).send({ error: '评论太长,最多 2000 字' });
    const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 32) || '匿名';
    const anonId = (typeof b.anonId === 'string' ? b.anonId.trim() : '').slice(0, 64);
    if (!anonId) return reply.code(400).send({ error: 'anonId required' });

    const item = await resolveItem(slug);
    if (!item) return reply.code(404).send({ error: 'item not found' });

    // 同指纹 30s rate-limit。NX 设置成功 = 之前没记录,允许;失败 = 已存在,挡掉
    const fp = fingerprint(req as any);
    const rlKey = `comment:rl:${fp}`;
    const setRes = await getRedis().set(rlKey, '1', 'EX', RL_WINDOW_SEC, 'NX');
    if (setRes !== 'OK') {
      return reply.code(429).send({ error: '发太快了,稍等一会再试' });
    }

    const result = await execute(
      `INSERT INTO comments (item_id, anon_id, display_name, body)
       VALUES ($1, $2, $3, $4)`,
      [item.id, anonId, name, body],
    );
    const insertId = (result as any).insertId ?? null;

    // 回读 DB 的 created_at — 用 INSERT 时刻的真实 DB 时间,而不是 response 拼装
    // 时刻的 new Date()。否则网络稍慢,客户端拿到的 createdAt 比 DB 真实时间还晚,
    // "刚刚" / "X 分钟前" 的相对时间会偏移。
    let createdAt = new Date().toISOString();
    if (insertId != null) {
      const [row] = await query<{ created_at: string }>(
        `SELECT created_at FROM comments WHERE id = $1`,
        [insertId],
      );
      if (row?.created_at) createdAt = new Date(row.created_at).toISOString();
    }

    return {
      ok: true,
      comment: { id: insertId, anonId, name, body, createdAt },
    };
  });
}
