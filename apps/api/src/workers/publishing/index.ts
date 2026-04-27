import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { makeUniqueSlug } from '../title/slug.js';
import { revalidatePaths } from './revalidate.js';

export interface PublishJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  slug: string | null;
  title: string | null;
  category: string | null;
}

export async function publishOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT id, status, slug, title, category FROM items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) return { skipped: true, reason: 'item not found' };

  // Publishing is terminal for the LLM chain. Accept anything post-title.
  // In strict production, restrict to COMPLIANCE_PASS.
  const allowed = ['COMPLIANCE_PASS', 'PUBLISHED'];
  const strict = process.env.PUBLISH_STRICT === '1';
  if (strict && !allowed.includes(item.status)) {
    return { skipped: true, reason: `strict mode: status=${item.status}` };
  }
  if (!item.title) throw new Error(`item ${itemId} has no title`);

  // Slug may be missing if the Title Agent hasn't run (no credits / MVP run).
  let slug = item.slug;
  if (!slug) {
    slug = await makeUniqueSlug(item.title, itemId);
  }

  const publishedUrl = `/a/${slug}`;
  const siteBase = process.env.SITE_URL ?? 'http://localhost:3000';
  const fullUrl = `${siteBase}${publishedUrl}`;

  await query(
    `UPDATE items
       SET status = 'PUBLISHED',
           slug = $2,
           published_url = $3,
           published_at = COALESCE(published_at, NOW())
     WHERE id = $1`,
    [itemId, slug, fullUrl],
  );

  // ISR drop: article page, category page, home, sitemap.
  const paths = ['/', `/a/${slug}`, '/sitemap.xml'];
  if (item.category) paths.push(`/category/${encodeURIComponent(item.category)}`);
  await revalidatePaths(paths);

  return { slug, publishedUrl, fullUrl, revalidated: paths };
}

export function startPublishingWorker() {
  return startWorker<PublishJob>(
    QUEUE_NAMES.publishing,
    async (job: Job<PublishJob>) => {
      return withRun({ agent: 'publishing', itemId: job.data.itemId }, async () => {
        const out = await publishOne(job.data.itemId);
        return { output: out };
      });
    },
    { concurrency: 2 },
  );
}
