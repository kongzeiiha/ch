import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun, type Model } from '@ch/agents';
import { classify, classifyByRules } from './categorize.js';
import { generateTitle, generateTitleByRules } from './generate.js';
import { makeUniqueSlug } from './slug.js';

export interface ClassifyTitleJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  title: string | null;
  content: string | null;
  category: string | null;
  tags: string[];
  keywords: string[];
}

interface ClassifyOutput {
  category: string;
  tags: string[];
  keywords: string[];
}

/**
 * Merged Classify+Title agent. Runs both LLM steps in sequence within one
 * worker job, removing the queue hop and intermediate CLASSIFIED status that
 * the old two-agent split required.
 *
 * Status transitions handled:
 *   INGESTED   → run classify, then title    → TITLED
 *   CLASSIFIED → skip classify, run title    → TITLED   (backlog from old pipeline)
 *   anything else → skip silently (pipeline already moved on)
 */
export async function classifyTitleOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT id, status, title, content, category, tags, keywords
     FROM items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found' };
  if (!['INGESTED', 'CLASSIFIED', 'TITLED'].includes(item.status)) {
    return { skipped: true, status: item.status };
  }

  const skipClassifyLlm = process.env.CLASSIFICATION_SKIP_LLM === '1';
  const skipTitleLlm = process.env.TITLE_SKIP_LLM === '1';
  const minLen = skipClassifyLlm && skipTitleLlm ? 10 : 40;
  if (!item.content || item.content.length < minLen) {
    throw new Error(`item ${itemId} content too short (${item.content?.length ?? 0}<${minLen})`);
  }

  // Aggregated telemetry (cost/usage from both LLM calls combined).
  let totalCost = 0;
  const usageAgg = { input_tokens: 0, output_tokens: 0 };
  const modelsUsed: string[] = [];

  // ── Step 1: classify (skipped if backlog already classified) ──────────
  let classified: ClassifyOutput;
  if (item.status === 'INGESTED') {
    if (skipClassifyLlm) {
      classified = classifyByRules({ title: item.title, content: item.content });
      modelsUsed.push('rule:keyword');
    } else {
      const modelName = (process.env.CLASSIFICATION_MODEL as Model) ?? 'haiku';
      const r = await classify({ title: item.title, content: item.content }, { model: modelName });
      classified = r.result;
      totalCost += r.cost;
      usageAgg.input_tokens += r.usage.input_tokens;
      usageAgg.output_tokens += r.usage.output_tokens;
      modelsUsed.push(r.model);
    }

    await query(
      `UPDATE items
         SET category = $2, tags = $3, keywords = $4, status = 'CLASSIFIED'
       WHERE id = $1`,
      [itemId, classified.category, classified.tags, classified.keywords],
    );
  } else {
    // Backlog: status is already CLASSIFIED (or TITLED retry) — reuse what's in DB.
    classified = {
      category: item.category ?? '其他',
      tags: item.tags ?? [],
      keywords: item.keywords ?? [],
    };
  }

  // ── Step 2: title ─────────────────────────────────────────────────────
  let titleOut: { candidates: string[]; best_index: number; summary: string };
  if (skipTitleLlm) {
    titleOut = generateTitleByRules({ originalTitle: item.title, content: item.content });
    modelsUsed.push('rule:original-title');
  } else {
    const modelName = (process.env.TITLE_MODEL as Model) ?? 'sonnet';
    const r = await generateTitle(
      {
        originalTitle: item.title,
        category: classified.category,
        tags: classified.tags,
        content: item.content,
      },
      { model: modelName },
    );
    titleOut = r.result;
    totalCost += r.cost;
    usageAgg.input_tokens += r.usage.input_tokens;
    usageAgg.output_tokens += r.usage.output_tokens;
    modelsUsed.push(r.model);
  }

  const best = titleOut.candidates[titleOut.best_index]!;
  const slug = await makeUniqueSlug(best, itemId);

  await query(
    `UPDATE items
       SET title = $2,
           summary = $3,
           slug = $4,
           title_version = title_version + 1,
           status = 'TITLED'
     WHERE id = $1`,
    [itemId, best, titleOut.summary, slug],
  );

  // Hand off to the Cover Agent. jobId dedupes concurrent retries.
  await getQueue(QUEUE_NAMES.cover).add(
    'render',
    { itemId },
    { jobId: `cover__${itemId}` },
  );

  return {
    category: classified.category,
    tags: classified.tags,
    keywords: classified.keywords,
    title: best,
    candidates: titleOut.candidates,
    summary: titleOut.summary,
    slug,
    cost: totalCost,
    model: modelsUsed.join('+'),
    usage: usageAgg,
  };
}

export function startClassifyTitleWorker() {
  return startWorker<ClassifyTitleJob>(
    QUEUE_NAMES.classifyTitle,
    async (job: Job<ClassifyTitleJob>) => {
      return withRun(
        { agent: 'classify-title', itemId: job.data.itemId },
        async () => {
          const out = await classifyTitleOne(job.data.itemId);
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
