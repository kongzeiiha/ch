import { query } from '../../lib/db';
import type { FeedFilter } from '../../lib/feed';

// Three kinds of 专题 share the /topic/[slug] route:
//   theme    — curated, declared in THEMES below
//   source   — auto-generated per source account, slug = `source-<uuid>`
//   keyword  — auto-generated per trending keyword, slug = `keyword-<encoded>`
// Slug prefixes are intentionally hyphenated rather than colon-delimited so
// they survive URL encoding cleanly and don't collide with theme slugs (which
// never contain `-source-` / `-keyword-` and are matched first anyway).
export type TopicKind = 'theme' | 'source' | 'keyword';

export interface TopicDef {
  slug: string;
  kind: TopicKind;
  title: string;
  description: string;
  filter: FeedFilter;
}

const SOURCE_PREFIX = 'source-';
const KEYWORD_PREFIX = 'keyword-';

// Curated themes. Append to extend; the home page's "主题专区" iterates this
// array and the sitemap surfaces every entry.
export const THEMES: TopicDef[] = [
  {
    slug: 'weekly-hot',
    kind: 'theme',
    title: '本周热门',
    description: '近 7 天阅读量最高的文章',
    filter: { sort: 'hot', date: '7d' },
  },
  {
    slug: 'long-reads',
    kind: 'theme',
    title: '深度长文',
    description: '15 分钟以上的深度阅读',
    filter: { length: 'long', sort: 'latest' },
  },
  {
    slug: 'fresh',
    kind: 'theme',
    title: '最新发布',
    description: '近 30 天的新文章',
    filter: { date: '30d', sort: 'latest' },
  },
];

/** Resolve any topic slug to a TopicDef. Themes are looked up locally;
 *  source/keyword topics derive their title from the slug and a single DB
 *  hit (for source name). Returns null on miss → topic page renders 404. */
export async function resolveTopic(slug: string): Promise<TopicDef | null> {
  const theme = THEMES.find((t) => t.slug === slug);
  if (theme) return theme;

  if (slug.startsWith(SOURCE_PREFIX)) {
    const sourceId = slug.slice(SOURCE_PREFIX.length);
    const rows = await query<{ name: string; platform: string }>(
      `SELECT name, platform FROM sources WHERE id = $1 LIMIT 1`,
      [sourceId],
    );
    if (!rows[0]) return null;
    return {
      slug,
      kind: 'source',
      title: rows[0].name,
      description: `${rows[0].name}(${rows[0].platform})出品的全部内容`,
      filter: { sourceId, sort: 'latest' },
    };
  }

  if (slug.startsWith(KEYWORD_PREFIX)) {
    const keyword = decodeURIComponent(slug.slice(KEYWORD_PREFIX.length));
    if (!keyword) return null;
    return {
      slug,
      kind: 'keyword',
      title: keyword,
      description: `所有围绕「${keyword}」的内容`,
      filter: { keyword, sort: 'latest' },
    };
  }

  return null;
}

/** All slugs to pre-render at build time: themes + top sources + top trending
 *  keywords. Cold slugs still resolve via dynamicParams=true ISR. */
export async function listKnownTopicSlugs(opts: { sources?: number; keywords?: number; keywordWindowDays?: number } = {}): Promise<string[]> {
  const sourcesLimit  = opts.sources  ?? 30;
  const keywordsLimit = opts.keywords ?? 30;
  const days          = opts.keywordWindowDays ?? 90;

  const [sources, keywords] = await Promise.all([
    query<{ id: string }>(
      `SELECT id FROM sources WHERE status = 'active'
       ORDER BY score DESC, last_fetch_at DESC
       LIMIT $1`,
      [sourcesLimit],
    ),
    query<{ keyword: string }>(
      `SELECT jt.keyword AS keyword, COUNT(*) AS count
       FROM items i,
            JSON_TABLE(i.keywords, '$[*]' COLUMNS (keyword VARCHAR(128) PATH '$')) jt
       WHERE i.status IN ('PUBLISHED','DISTRIBUTED')
         AND i.published_at >= DATE_SUB(NOW(), INTERVAL $1 DAY)
         AND jt.keyword IS NOT NULL
       GROUP BY jt.keyword
       ORDER BY count DESC
       LIMIT $2`,
      [days, keywordsLimit],
    ),
  ]);

  return [
    ...THEMES.map((t) => t.slug),
    ...sources.map((s) => `${SOURCE_PREFIX}${s.id}`),
    ...keywords.map((k) => `${KEYWORD_PREFIX}${encodeURIComponent(k.keyword)}`),
  ];
}
