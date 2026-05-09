import { createHash } from 'node:crypto';
import { query } from '@ch/db';

// CN/JP/KR-friendly slug generator. Earlier versions stripped non-ASCII which
// was hostile to Chinese SEO — slugs collapsed to bare URL fragments like
// `https-t-co-xxx-<hash>`. Modern crawlers (Google, Baidu, Bing) all support
// UTF-8 URLs, so we keep the CJK characters and let the site URL surface them
// as a ranking signal.

const URL_RE       = /https?:\/\/\S+/g;
const MENTION_RE   = /@[a-zA-Z0-9_]+/g;
const HASH_PREFIX  = /[#＃]/g;
// Punctuation across CJK + ASCII + zero-width / control chars. Anything that
// isn't a letter/digit/CJK ideograph/kana gets normalized to a separator.
const SEPARATOR_RE = /[\s\-_,.!?;:'"()\[\]{}<>/\\|@$%^&*+=~`，。、！？；：""''《》【】〔〕「」『』（）·…—​-‏﻿]+/g;
// Emoji & symbol blocks — strip before separator pass so they don't introduce
// stray hyphens.
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2700}-\u{27BF}]/gu;

const SLUG_MAX = 60;

function cleanTitle(s: string): string {
  return s
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(HASH_PREFIX, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(SEPARATOR_RE, '-')
    .toLowerCase()
    // Collapse runs of hyphens, trim leading/trailing
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Truncate to SLUG_MAX without breaking a multi-byte character. */
function truncate(s: string): string {
  if (s.length <= SLUG_MAX) return s;
  // Cut at the last `-` boundary within the limit so we don't end mid-word.
  const sliced = s.slice(0, SLUG_MAX);
  const lastDash = sliced.lastIndexOf('-');
  return (lastDash > 20 ? sliced.slice(0, lastDash) : sliced).replace(/-+$/, '');
}

/** Build a URL slug from a title. Empty/all-symbol titles fall back to the
 *  legacy hash-based form so we always have something to put in the URL. */
export function buildSlugStem(title: string): string {
  const cleaned = cleanTitle(title);
  return truncate(cleaned);
}

/**
 * Build a unique URL slug. Strategy:
 *   1. Generate a stem from the title (CJK preserved).
 *   2. If empty (title was all URL/emoji/punctuation), fall back to a
 *      6-char hash of the item id.
 *   3. Probe for uniqueness; on collision, append `-2`, `-3`, … up to 20.
 *      Beyond that, append a 6-char id hash.
 */
export async function makeUniqueSlug(title: string, itemId: string): Promise<string> {
  const stem = buildSlugStem(title);

  if (!stem || stem.length < 2) {
    const hash = createHash('sha256').update(itemId).digest('hex').slice(0, 8);
    return `article-${hash}`;
  }

  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? stem : `${stem}-${i + 1}`;
    const rows = await query<{ id: string }>(
      `SELECT id FROM items WHERE slug = $1 AND id <> $2 LIMIT 1`,
      [candidate, itemId],
    );
    if (rows.length === 0) return candidate;
  }

  // Pathological collision: hash-disambiguate.
  const hash = createHash('sha256').update(itemId).digest('hex').slice(0, 6);
  return `${stem}-${hash}`;
}
