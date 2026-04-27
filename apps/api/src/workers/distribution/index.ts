import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { rewriteForTwitter } from './rewrite.js';

export interface DistributionJob {
  itemId: string;
  channel?: string;
}

interface ItemRow {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  published_url: string | null;
  slug: string | null;
}

export async function distributeOne(itemId: string, channel = 'twitter') {
  const rows = await query<ItemRow>(
    `SELECT id, title, summary, category, tags, published_url, slug
     FROM items WHERE id = $1 AND status = 'PUBLISHED'`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found or not published' };
  if (!item.published_url) return { skipped: true, reason: 'no published_url' };

  // Skip if already distributed to this channel
  const existing = await query<{ id: string }>(
    `SELECT id FROM distribution_tasks WHERE item_id = $1 AND channel = $2 LIMIT 1`,
    [itemId, channel],
  );
  if (existing.length) return { skipped: true, reason: 'already distributed' };

  const result = await rewriteForTwitter({
    title: item.title,
    summary: item.summary,
    category: item.category,
    tags: item.tags,
    published_url: item.published_url,
  });

  await query(
    `INSERT INTO distribution_tasks (item_id, channel, copy, status)
     VALUES ($1, $2, $3, 'pending')`,
    [itemId, channel, result.copy],
  );

  await query(`UPDATE items SET status = 'DISTRIBUTED' WHERE id = $1`, [itemId]);

  return {
    channel,
    copy: result.copy,
    model: result.model,
    costUsd: result.costUsd,
  };
}

export function startDistributionWorker() {
  return startWorker<DistributionJob>(
    QUEUE_NAMES.distribution,
    async (job: Job<DistributionJob>) => {
      const { itemId, channel = 'twitter' } = job.data;
      return withRun({ agent: 'distribution', itemId }, async () => {
        const out = await distributeOne(itemId, channel);
        // Propagate model + cost so agent_runs accounting includes the
        // Sonnet rewrite spend instead of staying at 0 forever.
        return {
          output: out,
          model: (out as { model?: string }).model,
          cost: (out as { costUsd?: number }).costUsd,
          usage: (out as { usage?: unknown }).usage as any,
        };
      });
    },
    { concurrency: 3 },
  );
}
