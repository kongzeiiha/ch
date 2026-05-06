import { randomUUID } from 'node:crypto';
import { tx, ITEM_STATUS as IS } from '@ch/db';

export interface PersistInput {
  sourceId: string;
  url: string;
  fetchedAt: Date;
  rawPayload: unknown;
  mediaUrls: string[];
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
         (id, raw_item_id, source_id, status, title, summary, content, content_html)
       VALUES ($1,$2,$3,$8,$4,$5,$6,$7)`,
      [
        itemId,           // $1
        rawItemId,        // $2
        input.sourceId,   // $3
        input.title,      // $4
        input.summary,    // $5
        input.content,    // $6
        input.contentHtml, // $7
        IS.INGESTED,      // $8
      ],
    );

    await q(
      `UPDATE sources SET last_fetch_at = NOW() WHERE id = $1`,
      [input.sourceId],
    );

    return { rawItemId, itemId };
  });
}
