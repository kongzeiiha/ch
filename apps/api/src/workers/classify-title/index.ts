import type { Job } from 'bullmq';
import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun, permanent, type Model } from '@ch/agents';
import { displayTitle, cleanTagList } from '@ch/text-clean';
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
  /** Original RSS / source title from raw_items.raw_payload — used as the
   *  classification + title-generation input when items.title has been
   *  cleared by a TITLED→INGESTED rollback. */
  raw_title: string | null;
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
    `SELECT i.id, i.status, i.title, i.content, i.category, i.tags, i.keywords,
            JSON_UNQUOTE(JSON_EXTRACT(r.raw_payload, '$.title')) AS raw_title
     FROM items i JOIN raw_items r ON r.id = i.raw_item_id
     WHERE i.id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found' };
  if (![IS.INGESTED, IS.CLASSIFIED].includes(item.status as any)) {
    return { skipped: true, status: item.status };
  }
  // Fall back to raw_items.raw_payload.title when items.title has been
  // cleared (e.g. by a rollback). Without this, a re-classify after rollback
  // sees title=null and downstream tokenization plus generateTitleByRules
  // both end up with "未命名".
  const sourceTitle = item.title ?? item.raw_title ?? null;

  const skipClassifyLlm = process.env.CLASSIFICATION_SKIP_LLM === '1';
  const skipTitleLlm = process.env.TITLE_SKIP_LLM === '1';
  const minLen = skipClassifyLlm && skipTitleLlm ? 10 : 40;
  if (!item.content || item.content.length < minLen) {
    permanent(`item ${itemId} content too short (${item.content?.length ?? 0}<${minLen}) — won't improve on retry`);
  }

  // Aggregated telemetry (cost/usage from both LLM calls combined).
  let totalCost = 0;
  const usageAgg = { input_tokens: 0, output_tokens: 0 };
  const modelsUsed: string[] = [];

  // ── Step 1: classify (skipped if backlog already classified) ──────────
  let classified: ClassifyOutput;
  if (item.status === IS.INGESTED) {
    if (skipClassifyLlm) {
      classified = classifyByRules({ title: sourceTitle, content: item.content });
      modelsUsed.push('rule:keyword');
    } else {
      const modelName = (process.env.CLASSIFICATION_MODEL as Model) ?? 'haiku';
      const r = await classify({ title: sourceTitle, content: item.content }, { model: modelName });
      classified = r.result;
      totalCost += r.cost;
      usageAgg.input_tokens += r.usage.input_tokens;
      usageAgg.output_tokens += r.usage.output_tokens;
      modelsUsed.push(r.model);
    }

    // Filter LLM-junk tags/keywords (e.g. "关键词《X》", sentence-length
    // fragments, URL leftovers) at write-time — see @ch/text-clean. Doing
    // it here means the DB never holds the dirty arrays, so every reader
    // (frontend cards, JSON-LD, /admin) gets clean data without each
    // having to filter on read.
    classified.tags = cleanTagList(classified.tags);
    classified.keywords = cleanTagList(classified.keywords);
    await query(
      `UPDATE items
         SET category = $2, tags = $3, keywords = $4, status = $5
       WHERE id = $1`,
      [itemId, classified.category, classified.tags, classified.keywords, IS.CLASSIFIED],
    );
  } else {
    // Backlog: status is already CLASSIFIED (or TITLED retry) — reuse what's in DB.
    // Still run cleanTagList here in case the DB row was written before the
    // write-time sanitizer existed.
    classified = {
      category: item.category ?? '其他',
      tags: cleanTagList(item.tags ?? []),
      keywords: cleanTagList(item.keywords ?? []),
    };
  }

  // ── Step 2: title ─────────────────────────────────────────────────────
  let titleOut: { candidates: string[]; best_index: number; summary: string };
  if (skipTitleLlm) {
    titleOut = generateTitleByRules({ originalTitle: sourceTitle, content: item.content });
    modelsUsed.push('rule:original-title');
  } else {
    const modelName = (process.env.TITLE_MODEL as Model) ?? 'sonnet';
    const r = await generateTitle(
      {
        originalTitle: sourceTitle,
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

  // Write-time sanitization — see @ch/text-clean. The classify-title worker
  // is the single source of writes for items.title / items.summary, so
  // cleaning HERE means every reader (frontend H1, card H2, OG meta,
  // JSON-LD, sitemap) gets the clean string without each having to remember
  // to call displayTitle at render time. Slug is derived from the cleaned
  // title so the URL doesn't carry "关键词" / emoji / hashtag noise either.
  //
  // Both title and summary use the strict displayTitle pipeline (emoji +
  // hashtag-chain + arrow-deco + LLM-tail + repeat-punct + edge trim).
  // Different caps: title at 80 (H1 fits one line), summary at 300 (leaves
  // room for full <meta description> + OG description without truncation
  // surprises later).
  const rawBest = titleOut.candidates[titleOut.best_index]!;
  const best = displayTitle(rawBest, 80) || rawBest;
  const cleanedSummary = displayTitle(titleOut.summary, 300) || titleOut.summary;
  const slug = await makeUniqueSlug(best, itemId);

  await query(
    `UPDATE items
       SET title = $2,
           summary = $3,
           slug = $4,
           title_version = title_version + 1,
           status = $5
     WHERE id = $1`,
    [itemId, best, cleanedSummary, slug, IS.TITLED],
  );

  // Hand off to the Cover Agent. jobId dedupes concurrent retries while in
  // queue; `removeOnComplete: true` releases the id on success so a later
  // pipeline rerun isn't silently dropped by the dedup against the old
  // completed job (BullMQ checks waiting+active+completed sets).
  await getQueue(QUEUE_NAMES.cover).add(
    'render',
    { itemId },
    { jobId: `cover__${itemId}`, removeOnComplete: true },
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
