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
  return tx(async (q) => {
    const [raw] = await q(
      `INSERT INTO raw_items
         (source_id, url, fetched_at, raw_payload, media_urls,
          content_hash, dedupe_key, simhash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        input.sourceId,
        input.url,
        input.fetchedAt,
        JSON.stringify(input.rawPayload),
        input.mediaUrls,
        input.contentHash,
        input.dedupeKey,
        input.simhash.toString(),
      ],
    );

    const [item] = await q(
      `INSERT INTO items
         (raw_item_id, source_id, status, title, summary, content, content_html)
       VALUES ($1,$2,$7,$3,$4,$5,$6)
       RETURNING id`,
      [
        raw.id,           // $1
        input.sourceId,   // $2
        input.title,      // $3
        input.summary,    // $4
        input.content,    // $5
        input.contentHtml, // $6
        IS.INGESTED,      // $7
      ],
    );

    await q(
      `UPDATE sources SET last_fetch_at = NOW() WHERE id = $1`,
      [input.sourceId],
    );

    return { rawItemId: raw.id, itemId: item.id };
  });
}
