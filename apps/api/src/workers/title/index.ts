import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun, type Model } from '@ch/agents';
import { generateTitle, generateTitleByRules } from './generate.js';
import { makeUniqueSlug } from './slug.js';

export interface TitleJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  title: string | null;
  content: string | null;
  category: string | null;
  tags: string[];
}

async function titleOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT id, status, title, content, category, tags
     FROM items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found' };
  if (!['CLASSIFIED', 'TITLED'].includes(item.status)) {
    return { skipped: true, status: item.status };
  }
  const skipLlm = process.env.TITLE_SKIP_LLM === '1';
  const minLen = skipLlm ? 5 : 40;
  if (!item.content || item.content.length < minLen) {
    throw new Error(`item ${itemId} content too short (${item.content?.length ?? 0}<${minLen})`);
  }

  let out: { candidates: string[]; best_index: number; summary: string };
  let cost = 0, model: string | null = null, usage: any;

  if (skipLlm) {
    out = generateTitleByRules({ originalTitle: item.title, content: item.content });
    model = 'rule:original-title';
  } else {
    const modelName = (process.env.TITLE_MODEL as Model) ?? 'sonnet';
    const r = await generateTitle(
      { originalTitle: item.title, category: item.category, tags: item.tags, content: item.content },
      { model: modelName },
    );
    out = r.result;
    cost = r.cost;
    model = r.model;
    usage = r.usage;
  }

  const best = out.candidates[out.best_index]!;
  const slug = await makeUniqueSlug(best, itemId);

  await query(
    `UPDATE items
       SET title = $2,
           summary = $3,
           slug = $4,
           title_version = title_version + 1,
           status = 'TITLED'
     WHERE id = $1`,
    [itemId, best, out.summary, slug],
  );

  // Hand off to the Cover Agent.
  await getQueue(QUEUE_NAMES.cover).add(
    'render',
    { itemId },
    { jobId: `cover__${itemId}` },
  );

  return {
    title: best,
    candidates: out.candidates,
    summary: out.summary,
    slug,
    cost,
    model,
    usage,
  };
}

export function startTitleWorker() {
  return startWorker<TitleJob>(
    QUEUE_NAMES.title,
    async (job: Job<TitleJob>) => {
      return withRun(
        { agent: 'title', itemId: job.data.itemId },
        async () => {
          const out = await titleOne(job.data.itemId);
          return {
            output: out,
            model: (out as any).model,
            usage: (out as any).usage,
            cost: (out as any).cost,
          };
        },
      );
    },
    { concurrency: 1 },
  );
}
