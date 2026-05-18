/**
 * 手工发帖端点 — 不走爬虫,直接把人工填的标题/正文/媒体落到 raw_items+items,
 * 然后入 classify-title 队列,让自动管线接管(分类→标题候选→封面→合规→发布)。
 *
 * 使用场景:运营要补一篇关键内容,但来源不在采集列表里,或临时整理一段独家素材。
 *
 *   POST /admin/posts/manual
 *   Body: {
 *     title: string,          // 必填,LLM 会基于此再候选生成最终标题
 *     content: string,        // 必填,正文(纯文本即可,自动包<p>)
 *     category?: string,      // 可选,LLM 没跑前的默认分类
 *     tags?: string[],        // 可选
 *     mediaUrls?: string[],   // 图片 URL 列表
 *     videoUrls?: string[],   // 视频 mp4 URL 列表
 *     skipAutoPipeline?: bool // true 时停留在 INGESTED 不自动入队,等工作台人工推
 *   }
 *
 *   返回 { rawItemId, itemId, slug, enqueued } - slug 是后续 classify-title 算的,
 *   这里先返回 itemId,真正能访问的 /a/<slug> 要等 publishing 后。
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { query, execute, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { persistIngested } from './workers/ingestion/persist.js';
import { simhash } from './workers/ingestion/simhash.js';
import { uploadBuffer } from './workers/cover/storage.js';
import { logOperation } from './op-log.js';

const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/i;
const ALLOWED_VIDEO = /^video\/(mp4|webm|quicktime)$/i;

const MANUAL_PLATFORM = 'manual';
const MANUAL_EXTERNAL_ID = 'manual-posts';

/** 第一次手工发帖时建一行 sources 占位;之后所有手工帖共享这一个 source_id。
 *  这样 raw_items.source_id FK 有归属,workbench 看到一个名为「手工录入」的源。 */
async function getOrCreateManualSource(): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM sources WHERE platform = $1 AND external_id = $2 LIMIT 1`,
    [MANUAL_PLATFORM, MANUAL_EXTERNAL_ID],
  );
  if (rows[0]) return rows[0].id;

  const id = randomUUID();
  await execute(
    `INSERT INTO sources (id, platform, external_id, name, url, config, status, score)
     VALUES ($1, $2, $3, '手工录入', '', '{}', 'active', 50)`,
    [id, MANUAL_PLATFORM, MANUAL_EXTERNAL_ID],
  );
  return id;
}

export function registerManualPost(app: FastifyInstance): void {
  app.post<{
    Body: {
      title: string;
      content: string;
      category?: string;
      tags?: string[];
      mediaUrls?: string[];
      videoUrls?: string[];
      skipAutoPipeline?: boolean;
      /** 可选:把这条手工帖挂到指定 source 名下;留空走 fallback 的"手工录入"源。
       *  必须是已存在的 sources.id,否则 400。 */
      sourceId?: string;
    };
  }>('/admin/posts/manual', async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title 必填' });
    }
    if (!b.content || typeof b.content !== 'string' || b.content.trim().length < 10) {
      return reply.code(400).send({ error: 'content 必填,至少 10 个字符' });
    }
    const title = b.title.trim().slice(0, 500);
    const content = b.content.trim().slice(0, 50_000);
    const mediaUrls = Array.isArray(b.mediaUrls) ? b.mediaUrls.filter((u) => typeof u === 'string').slice(0, 30) : [];
    const videoUrls = Array.isArray(b.videoUrls) ? b.videoUrls.filter((u) => typeof u === 'string').slice(0, 10) : [];

    // dedupeKey 必须全局唯一(platform+external_id 维度上唯一即可,但这里全用 manual)
    // 用 hash(title+content) 作为 external_id 派生,同一标题+正文重复提交会被
    // raw_items 的 UNIQUE(source_id, dedupe_key) 拦下 — 防误操作连点两下重复发。
    const dedupeSeed = `${title}::${content.slice(0, 200)}`;
    const contentHash = createHash('sha256').update(content).digest('hex');
    const dedupeKey = createHash('sha256').update(dedupeSeed).digest('hex').slice(0, 32);

    // 选发帖人:body 里给了 sourceId 就校验后用;没给就 fallback 到"手工录入"源。
    let sourceId: string;
    if (b.sourceId && typeof b.sourceId === 'string') {
      const rows = await query<{ id: string }>(
        `SELECT id FROM sources WHERE id = $1 AND status = 'active' LIMIT 1`,
        [b.sourceId],
      );
      if (!rows[0]) return reply.code(400).send({ error: `指定的 sourceId 不存在或已停用: ${b.sourceId}` });
      sourceId = rows[0].id;
    } else {
      sourceId = await getOrCreateManualSource();
    }

    // raw_items + items 行入库(走和爬虫一样的 persistIngested,后续 worker 不区分)
    const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let result;
    try {
      result = await persistIngested({
        sourceId,
        url: '',                        // 手工帖无外链
        fetchedAt: new Date(),
        rawPayload: { title, manual: true, category: b.category, tags: b.tags },
        mediaUrls,
        videoSourceUrls: videoUrls.length ? videoUrls : undefined,
        contentHash,
        dedupeKey,
        simhash: simhash(content),
        title,
        summary: content.slice(0, 220),
        content,
        contentHtml: `<p>${escaped.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`,
      });
    } catch (e: any) {
      // UNIQUE 冲突 → 同标题正文已发过
      if (String(e?.message ?? '').includes('Duplicate') || e?.code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({ error: '该标题+正文已存在,请勿重复提交' });
      }
      throw e;
    }

    // category / tags 在 PersistInput 里没有字段,后写一次 UPDATE 把它们落进 items
    if (b.category || (b.tags && b.tags.length)) {
      await execute(
        `UPDATE items SET
           category = COALESCE($2, category),
           tags = COALESCE($3, tags)
         WHERE id = $1`,
        [result.itemId, b.category ?? null, b.tags?.length ? JSON.stringify(b.tags) : null],
      );
    }

    // 自动入队 classify-title,后续 cover→compliance→publishing 由 auto-pipeline 串
    let enqueued = false;
    if (!b.skipAutoPipeline) {
      const q = getQueue(QUEUE_NAMES.classifyTitle);
      await q.add(
        'classify-title',
        { itemId: result.itemId },
        { jobId: `classify-title__${result.itemId}`, removeOnComplete: true },
      );
      enqueued = true;
    }

    await logOperation(req, {
      operation: 'manual-post.create',
      targetType: 'item',
      targetId: result.itemId,
      payload: { title, hasMedia: mediaUrls.length, hasVideo: videoUrls.length, enqueued },
    });

    return {
      rawItemId: result.rawItemId,
      itemId: result.itemId,
      enqueued,
      // 两条路径都落在 INGESTED:enqueued=true 时由 classify-title worker 接力推进,
      // skipAutoPipeline=true 时停在 INGESTED 等工作台手动操作。
      status: IS.INGESTED,
      hint: enqueued
        ? '已入队,等待 classify-title → cover → compliance → publishing'
        : '已落库,处于 INGESTED 状态,到工作台手动推进',
    };
  });

  // 创建一个手工发帖人 — 在 sources 表里加一行 platform='manual' 的占位源,
  // 之后手工帖可以选这个 source_id 当归属。公开站点上 virtualBlogger 会识别
  // platform='manual' 走直显路径,把 name 当公开博主名,不再哈希遮蔽。
  //
  //   POST /admin/posts/manual-source
  //   Body: { name: string }
  //   Resp: { source: { id, name, platform, external_id } }
  app.post<{ Body: { name: string } }>('/admin/posts/manual-source', async (req, reply) => {
    const rawName = (req.body?.name ?? '').trim();
    if (!rawName) return reply.code(400).send({ error: 'name 必填' });
    if (rawName.length > 64) return reply.code(400).send({ error: 'name 不能超过 64 字' });

    // external_id 用 name 的 sha 派生,保证(platform, external_id)主键唯一
    // 但同名重复创建会走 ON DUPLICATE KEY UPDATE 的 UPSERT 路径,不报错。
    const externalId = `manual-${createHash('sha256').update(rawName).digest('hex').slice(0, 16)}`;
    const newId = randomUUID();

    await execute(
      `INSERT INTO sources (id, platform, external_id, name, url, config, status, score)
       VALUES ($1, 'manual', $2, $3, '', '{}', 'active', 50)
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'active'`,
      [newId, externalId, rawName],
    );

    // UPSERT 后回查真实的 id(可能是已存在行的 id,而不是 newId)
    const rows = await query<{ id: string; name: string; platform: string; external_id: string }>(
      `SELECT id, name, platform, external_id FROM sources WHERE platform = 'manual' AND external_id = $1`,
      [externalId],
    );
    const source = rows[0]!;

    await logOperation(req, {
      operation: 'manual-source.create',
      targetType: 'source',
      targetId: source.id,
      payload: { name: rawName, externalId },
    });

    return { source };
  });

  // 文件上传端点 — 接 multipart,落 MinIO,返回 [{url, kind, name, size}]。
  //
  // 走 manual/<uuid>/ key prefix,跟 ingestion 的 videos/<rawItemId>/ 分开,
  // 不会跟正常爬虫流的对象冲突。返回 MinIO 公开 URL(经 media-proxy 走),
  // 前端把 url 拼到 mediaUrls / videoUrls 数组里再随手工帖一起提交。
  app.post('/admin/posts/upload', async (req, reply) => {
    const parts = req.parts();
    const out: Array<{ url: string; kind: 'image' | 'video'; name: string; size: number }> = [];
    const batchId = randomUUID();

    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const mime = part.mimetype ?? '';
      const isImage = ALLOWED_IMAGE.test(mime);
      const isVideo = ALLOWED_VIDEO.test(mime);
      if (!isImage && !isVideo) {
        return reply.code(400).send({ error: `不支持的文件类型: ${mime || part.filename}` });
      }

      // 收 buffer。@fastify/multipart 的 limits.fileSize 在头部 register 时已限到 50MB,
      // 超限会自动 truncated=true,这里再校验一次防御性兜底。
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      if (part.file.truncated) {
        return reply.code(413).send({ error: `文件 ${part.filename} 超过 50MB 上限` });
      }
      const buf = Buffer.concat(chunks);

      // key:manual/<batchId>/<原文件名> — batchId 防止同一次提交里同名文件互相覆盖
      const safeName = (part.filename || 'file').replace(/[^\w.-]/g, '_').slice(0, 80);
      const key = `manual/${batchId}/${safeName}`;
      const url = await uploadBuffer(key, buf, mime);
      out.push({ url, kind: isImage ? 'image' : 'video', name: safeName, size: buf.length });
    }

    if (out.length === 0) return reply.code(400).send({ error: '没有可用文件' });

    await logOperation(req, {
      operation: 'manual-post.upload',
      targetType: 'system',
      targetId: null,
      payload: { count: out.length, totalBytes: out.reduce((n, x) => n + x.size, 0) },
    });

    return { files: out };
  });
}
