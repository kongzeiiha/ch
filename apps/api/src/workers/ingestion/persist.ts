import { randomUUID } from 'node:crypto';
import { tx, query, ITEM_STATUS as IS } from '@ch/db';
import { uploadVideoFromUrl } from '../cover/storage.js';

export interface PersistInput {
  sourceId: string;
  url: string;
  fetchedAt: Date;
  /** 原平台的真实发布时间(X 的 legacy.created_at, RSS 的 pubDate 等)。
   *  写进 items.published_at;publishing worker 用 COALESCE 不会覆盖。
   *  没拿到(手工源 / 平台没暴露)就传 undefined,publishing 时回落到 NOW()。 */
  publishedAt?: Date;
  rawPayload: unknown;
  mediaUrls: string[];
  /** Source video URLs (e.g. X CDN mp4). Downloaded async after persist. */
  videoSourceUrls?: string[];
  contentHash: string;
  dedupeKey: string;
  simhash: bigint;
  title: string | null;
  summary: string | null;
  content: string;
  contentHtml: string;
}

export interface PersistResult {
  rawItemId: string;
  itemId: string;
}

export async function persistIngested(input: PersistInput): Promise<PersistResult> {
  const rawItemId = randomUUID();
  const itemId = randomUUID();
  return tx(async (q) => {
    await q(
      `INSERT INTO raw_items
         (id, source_id, url, fetched_at, raw_payload, media_urls,
          content_hash, dedupe_key, simhash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        rawItemId,
        input.sourceId,
        input.url,
        input.fetchedAt,
        JSON.stringify(input.rawPayload),
        JSON.stringify(input.mediaUrls),
        input.contentHash,
        input.dedupeKey,
        input.simhash.toString(),
      ],
    );

    await q(
      `INSERT INTO items
         (id, raw_item_id, source_id, status, title, summary, content, content_html, published_at)
       VALUES ($1,$2,$3,$8,$4,$5,$6,$7,$9)`,
      [
        itemId,             // $1
        rawItemId,          // $2
        input.sourceId,     // $3
        input.title,        // $4
        input.summary,      // $5
        input.content,      // $6
        input.contentHtml,  // $7
        IS.INGESTED,        // $8
        input.publishedAt ?? null,  // $9 — 原平台时间;NULL 时 publishing 用 NOW()
      ],
    );

    await q(
      `UPDATE sources SET last_fetch_at = NOW() WHERE id = $1`,
      [input.sourceId],
    );

    return { rawItemId, itemId };
  }).then(async (result) => {
    // Mirror videos to MinIO outside the transaction. Best-effort: failures
    // here don't reverse the persist (raw_payload still holds the source URL).
    const sources = input.videoSourceUrls ?? [];
    if (sources.length > 0) {
      const ourUrls: string[] = [];
      const durations: number[] = [];
      for (let i = 0; i < sources.length; i++) {
        const ext = pickExt(sources[i]!);
        const uploaded = await uploadVideoFromUrl(sources[i]!, `videos/${result.rawItemId}/${i}${ext}`);
        if (uploaded) {
          ourUrls.push(uploaded.url);
          if (uploaded.durationSec != null) durations.push(uploaded.durationSec);
        }
      }
      if (ourUrls.length > 0) {
        await query(
          `UPDATE raw_items SET video_urls = $2 WHERE id = $1`,
          [result.rawItemId, JSON.stringify(ourUrls)],
        );
      }
      // Stamp the longest video duration onto items.duration_sec so the feed's
      // length filter has a single column to range-scan. Multi-video posts
      // (X carousels are uncommon) pick the max — same intuition as "longest
      // clip drives the post's overall length".
      if (durations.length > 0) {
        const maxDuration = Math.max(...durations);
        await query(
          `UPDATE items SET duration_sec = $2 WHERE id = $1`,
          [result.itemId, maxDuration],
        );
      }
    }
    return result;
  });
}

function pickExt(url: string): string {
  // Strip query string before checking extension
  const path = url.split('?')[0]!.toLowerCase();
  if (path.endsWith('.webm')) return '.webm';
  if (path.endsWith('.mov'))  return '.mov';
  if (path.endsWith('.m3u8')) return '.m3u8';  // HLS playlist (won't actually stream, but stored)
  return '.mp4';
}
