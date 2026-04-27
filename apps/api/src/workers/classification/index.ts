import type { Job } from 'bullmq';
import { query } from '@ch/db';
import {
  getQueue,
  QUEUE_NAMES,
  startWorker,
  withRun,
  type Model,
} from '@ch/agents';
import { classify, classifyByRules } from './categorize.js';

export interface ClassifyJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  title: string | null;
  content: string | null;
}

async function classifyOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT id, status, title, content FROM items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found' };
  if (!['INGESTED', 'CLASSIFIED'].includes(item.status)) {
    // Skip silently — pipeline moved on
    return { skipped: true, status: item.status };
  }
  const skipLlm = process.env.CLASSIFICATION_SKIP_LLM === '1';
  const minLen = skipLlm ? 10 : 40;
  if (!item.content || item.content.length < minLen) {
    throw new Error(`item ${itemId} content too short (${item.content?.length ?? 0}<${minLen})`);
  }

  let category: string, tags: string[], keywords: string[];
  let cost = 0, model: string | null = null, usage: any;

  if (skipLlm) {
    const out = classifyByRules({ title: item.title, content: item.content });
    category = out.category;
    tags = out.tags;
    keywords = out.keywords;
    model = 'rule:keyword';
  } else {
    const modelName = (process.env.CLASSIFICATION_MODEL as Model) ?? 'haiku';
    const r = await classify({ title: item.title, content: item.content }, { model: modelName });
    category = r.result.category;
    tags = r.result.tags;
    keywords = r.result.keywords;
    cost = r.cost;
    model = r.model;
    usage = r.usage;
  }

  await query(
    `UPDATE items
       SET category = $2,
           tags = $3,
           keywords = $4,
           status = 'CLASSIFIED'
     WHERE id = $1`,
    [itemId, category, tags, keywords],
  );

  // Hand off to the Title Agent. jobId dedupes concurrent retries.
  await getQueue(QUEUE_NAMES.title).add(
    'generate',
    { itemId },
    { jobId: `title__${itemId}` },
  );

  return { category, tags, keywords, cost, model, usage };
}

export function startClassificationWorker() {
  return startWorker<ClassifyJob>(
    QUEUE_NAMES.classification,
    async (job: Job<ClassifyJob>) => {
      return withRun(
        { agent: 'classification', itemId: job.data.itemId },
        async () => {
          const out = await classifyOne(job.data.itemId);
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
