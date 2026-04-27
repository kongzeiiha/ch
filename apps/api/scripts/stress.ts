/**
 * Day 7 全链路压测脚本
 * 用法: pnpm --filter @ch/api seed   （先跑一次 seed 建 source）
 *       pnpm --filter @ch/api stress
 *
 * 向 raw_items + items 直接插入 N 条记录，然后把所有 INGESTED 状态的 item
 * 推进 classification 队列，触发完整的 Classification→Title→Cover→Compliance→Publishing 链路。
 */

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const { query, tx } = await import('@ch/db');
const { getQueue, QUEUE_NAMES } = await import('@ch/agents');

const N = Number(process.env.STRESS_N ?? 500);

async function getOrCreateSource(): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM sources WHERE platform = 'stress-test' LIMIT 1`,
  );
  if (existing[0]) return existing[0].id;

  const rows = await query<{ id: string }>(
    `INSERT INTO sources (platform, external_id, name, url, status)
     VALUES ('stress-test', 'stress-001', 'Stress Test Source', 'http://localhost', 'active')
     ON CONFLICT (platform, external_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  return rows[0].id;
}

async function insertBatch(sourceId: string, batchStart: number, batchSize: number): Promise<string[]> {
  const itemIds: string[] = [];

  await tx(async (q) => {
    for (let i = batchStart; i < batchStart + batchSize; i++) {
      const dedupeKey = `stress__${i}__${Date.now()}`;
      const content = `这是第 ${i + 1} 篇压测文章的正文内容。包含足够长的文本用于测试分类、标题生成和合规审查流程。压测编号: ${i + 1}，时间戳: ${Date.now()}。本文讨论了人工智能在内容自动化领域的应用，以及多智能体系统的协作机制。通过自动化管线，我们能够高效处理大量内容并保证质量。`;

      const rawRows = await q(
        `INSERT INTO raw_items (source_id, url, raw_payload, content_hash, dedupe_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          sourceId,
          `http://stress-test.local/article/${i}`,
          JSON.stringify({ title: `压测文章 ${i + 1}`, stress: true }),
          `stress_hash_${i}_${Date.now()}`,
          dedupeKey,
        ],
      );
      const rawItemId = rawRows[0].id;

      const itemRows = await q(
        `INSERT INTO items (raw_item_id, source_id, status, title, summary, content, content_html)
         VALUES ($1, $2, 'INGESTED', $3, $4, $5, $6)
         RETURNING id`,
        [
          rawItemId,
          sourceId,
          `压测文章 ${i + 1}：AI 内容自动化探索`,
          `第 ${i + 1} 篇压测文章摘要，涵盖 AI 内容管线的核心流程。`,
          content,
          `<p>${content}</p>`,
        ],
      );
      itemIds.push(itemRows[0].id);
    }
  });

  return itemIds;
}

async function main() {
  console.log(`[stress] 开始压测，目标 ${N} 条记录...`);
  const sourceId = await getOrCreateSource();
  console.log(`[stress] source_id=${sourceId}`);

  const batchSize = 50;
  let inserted = 0;
  const allItemIds: string[] = [];

  for (let b = 0; b < N; b += batchSize) {
    const size = Math.min(batchSize, N - b);
    const ids = await insertBatch(sourceId, b, size);
    allItemIds.push(...ids);
    inserted += ids.length;
    process.stdout.write(`\r[stress] 插入进度: ${inserted}/${N}`);
  }
  console.log(`\n[stress] 插入完成，共 ${inserted} 条`);

  // 推进分类队列
  const q = getQueue(QUEUE_NAMES.classification);
  let enqueued = 0;
  for (const itemId of allItemIds) {
    await q.add('classify', { itemId }, { jobId: `classify__${itemId}` });
    enqueued++;
  }
  console.log(`[stress] 已入队 ${enqueued} 条分类任务，全链路正在异步处理...`);
  console.log('[stress] 完成。用 /admin 查看队列处理进度。');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
