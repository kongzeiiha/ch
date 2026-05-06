import type { Job } from 'bullmq';
import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { pickBest, pickTopN } from './select.js';
import { renderSizes, SIZES, type SizeName } from './resize.js';
import { uploadBuffer } from './storage.js';
import { generateCaption } from './caption.js';

export interface CoverJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  title: string | null;
  media_urls: string[];
  platform: string;
  source_config: Record<string, unknown> | null;
}

// For HTML-list sources, pages tend to be image-heavy (photo collections,
// long-form features). Keep top-N images as a gallery, not just the cover.
const GALLERY_SIZE_BY_PLATFORM: Record<string, number> = {
  html: 6,
};

async function uploadSizes(itemId: string, index: number, buffer: Buffer): Promise<Record<string, string>> {
  const sizes = await renderSizes(buffer);
  const prefix = index === 0 ? 'covers' : `covers/gallery/${index}`;
  const urls: Record<string, string> = {};
  for (const name of Object.keys(SIZES) as SizeName[]) {
    urls[name] = await uploadBuffer(
      `${prefix}/${itemId}/${name}.jpg`,
      sizes[name],
      'image/jpeg',
    );
  }
  return urls;
}

export async function coverOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT i.id, i.status, i.title, r.media_urls, s.platform, s.config AS source_config
     FROM items i
     JOIN raw_items r ON r.id = i.raw_item_id
     JOIN sources s   ON s.id = i.source_id
     WHERE i.id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) {
    // Item was deleted between queue and worker — skip silently rather than
    // burning retry budget on a now-impossible job.
    return { skipped: true, reason: 'item not found' };
  }
  if (![IS.TITLED, IS.COVERED].includes(item.status as any)) {
    return { skipped: true, status: item.status };
  }

  const wantN = GALLERY_SIZE_BY_PLATFORM[item.platform] ?? 1;
  // Pass source platform + config so select.ts can attach the right Referer /
  // Cookie when downloading from hotlink-protected hosts (pic.ylimg.com / CF).
  const hint = { platform: item.platform, config: item.source_config ?? {} };
  const picks = wantN > 1
    ? await pickTopN(item.media_urls ?? [], wantN, hint)
    : [await pickBest(item.media_urls ?? [], hint)].filter(Boolean) as any;

  let coverUrl: string | null = null;
  let coverSizes: Record<string, unknown> | null = null;
  let coverCopy: string | null = null;
  let llmCost = 0;
  let llmModel: string | null = null;

  if (picks.length > 0) {
    const primarySizes = await uploadSizes(itemId, 0, picks[0].buffer);
    coverUrl = primarySizes.card;
    coverSizes = { ...primarySizes };

    // Upload the rest as a gallery (HTML-list sources only).
    if (picks.length > 1) {
      const gallery: Array<Record<string, string>> = [];
      for (let i = 1; i < picks.length; i++) {
        const urls = await uploadSizes(itemId, i, picks[i].buffer);
        gallery.push(urls);
      }
      coverSizes.gallery = gallery;
    }

    if (item.title) {
      if (process.env.COVER_SKIP_LLM === '1') {
        // No LLM: use the article title as the cover alt text verbatim.
        coverCopy = item.title;
        llmModel = 'rule:title';
      } else {
        const cap = await generateCaption(item.title);
        if (cap) {
          coverCopy = cap.text;
          llmCost = cap.cost;
          llmModel = cap.model;
        }
      }
    }
  }

  await query(
    `UPDATE items
       SET cover_url = $2,
           cover_sizes = $3,
           cover_copy = $4,
           status = $5
     WHERE id = $1`,
    [itemId, coverUrl, coverSizes ? JSON.stringify(coverSizes) : null, coverCopy, IS.COVERED],
  );

  // Hand off to Compliance.
  await getQueue(QUEUE_NAMES.compliance).add(
    'check',
    { itemId },
    { jobId: `compliance__${itemId}` },
  );

  const best = picks[0] ?? null;
  return {
    picked: best ? { url: best.url, width: best.width, height: best.height, score: best.score } : null,
    gallery_count: Math.max(0, picks.length - 1),
    cover_url: coverUrl,
    cover_copy: coverCopy,
    cost: llmCost,
    model: llmModel,
  };
}

export function startCoverWorker() {
  return startWorker<CoverJob>(
    QUEUE_NAMES.cover,
    async (job: Job<CoverJob>) => {
      return withRun({ agent: 'cover', itemId: job.data.itemId }, async () => {
        const out = await coverOne(job.data.itemId);
        return { output: out, model: (out as any).model ?? undefined, cost: (out as any).cost };
      });
    },
    { concurrency: 6 },
  );
}
