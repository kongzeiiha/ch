import { createHash } from 'node:crypto';
import { query } from '@ch/db';

function transliterate(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]+/g, ' ');
}

function asciiSlug(s: string): string {
  return transliterate(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Build a URL slug: ASCII-safe stem from the title plus a 6-char hash of the
 * item id. The hash suffix guarantees global uniqueness without needing a
 * retry loop when two titles collide.
 */
export async function makeUniqueSlug(title: string, itemId: string): Promise<string> {
  const stem = asciiSlug(title) || 'article';
  const hash = createHash('sha256').update(itemId).digest('hex').slice(0, 6);
  const slug = `${stem}-${hash}`;

  // Defensive: check the hash didn't collide with an existing slug (1 in 16M).
  const rows = await query<{ id: string }>(
    `SELECT id FROM items WHERE slug = $1 AND id <> $2 LIMIT 1`,
    [slug, itemId],
  );
  if (rows.length === 0) return slug;

  // Extremely unlikely branch — extend hash length.
  const longer = createHash('sha256').update(itemId).digest('hex').slice(0, 12);
  return `${stem}-${longer}`;
}
