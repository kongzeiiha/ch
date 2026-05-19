/**
 * 自建 PV/UV 埋点 — 不依赖 GA4。
 *
 * 客户端在 /a/<slug> 渲染后 fire 一次 POST /pv/<slug>,这里:
 *   1. slug → item_id 查表
 *   2. Redis 用 (ip_hash + ua_hash + date) 做 UV 去重(24h TTL)
 *   3. UPSERT analytics_daily 一行,channel='site',按需 +pv +uv
 *
 * 一切 best-effort:bot 过滤 + 慢路径不阻塞响应,避免拖慢页面。
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { query, execute } from '@ch/db';
import { getRedis } from '@ch/agents';

const BOT_RE = /bot|spider|crawl|slurp|fetch|monitor|preview|headless|wget|curl/i;

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function registerSiteAnalytics(app: FastifyInstance): void {
  app.post<{ Params: { slug: string } }>('/pv/:slug', async (req, reply) => {
    const slug = decodeURIComponent(req.params.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug required' });

    // Bot filter — User-Agent 含典型爬虫关键词直接 noop,不污染统计
    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOT_RE.test(ua)) {
      return { ok: true, counted: false, reason: 'bot' };
    }

    // slug → item_id (兼容 legacy_slug 重定向后还在用老 slug 的客户端)
    const rows = await query<{ id: string }>(
      `SELECT id FROM items
       WHERE (slug = $1 OR legacy_slug = $1)
         AND status IN ('PUBLISHED','DISTRIBUTED')
       LIMIT 1`,
      [slug],
    );
    const itemId = rows[0]?.id;
    if (!itemId) return reply.code(404).send({ error: 'item not found' });

    // UV 去重 key:今天 + 客户端指纹。指纹只用 IP+UA 哈希,不存原值
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0]!.trim();
    const fingerprint = hash(`${ip}|${ua}`);
    const dedupKey = `pv:uv:${today}:${itemId}:${fingerprint}`;

    let isNewUv = true;
    try {
      // SET NX:首次返回 'OK',重复返回 null → 当天该指纹已计过 UV
      const r = await getRedis().set(dedupKey, '1', 'EX', 86_400, 'NX');
      isNewUv = r === 'OK';
    } catch (e: any) {
      // Redis 挂了不应该影响 PV 写入,降级到"每次都算 UV"(轻微高估,可接受)
      console.warn('[site-analytics] redis dedup failed:', e?.message ?? e);
    }

    // UPSERT analytics_daily — 同 item_id+date+channel 累加 pv/uv
    await query(
      `INSERT INTO analytics_daily (item_id, date, channel, pv, uv)
       VALUES ($1, $2, 'site', 1, $3)
       ON DUPLICATE KEY UPDATE
         pv = pv + 1,
         uv = uv + $3`,
      [itemId, today, isNewUv ? 1 : 0],
    );

    // 同步 +1 物化列 items.pv_30d,文章页 EyeIcon 立即可见。
    // 分析 worker 每小时会从 analytics_daily 真实滚动重算。
    await execute(`UPDATE items SET pv_30d = COALESCE(pv_30d, 0) + 1 WHERE id = $1`, [itemId]);
    // PV 是每次进文章页都 fire 的高频事件 — *不* flush 列表缓存。
    // 否则站点稍微有点流量就把所有列表页 HTTP 命中率打到地板,后端反复跑
    // ROW_NUMBER + JSON_TABLE 拖响应。列表卡片的浏览数靠 TTL 自然刷新,延迟可接受。
    // 点赞 / 评论是低频且用户期望即时反馈,才走 flushFeedCache。

    return { ok: true, counted: true, newUv: isNewUv };
  });
}
