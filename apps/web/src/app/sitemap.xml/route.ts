import { query, SITE_URL } from '../../lib/db';
import { getTopTags } from '../../lib/feed';
import { listKnownTopicSlugs } from '../_data/topics';

// Force-dynamic instead of ISR so `next build` doesn't try to prerender this
// route when the DB happens to be down (CI / fresh boots / Docker rebooting).
// Crawlers hit /sitemap.xml at most once per crawl cycle (~hours), so the
// extra SQL per fetch is negligible — and we gain build-time resilience.
export const dynamic = 'force-dynamic';

const toIso = (d: string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

export async function GET() {
  const [articles, categories, tags, topicSlugs, globalLatest] = await Promise.all([
    query<{ slug: string; published_at: string | null }>(
      `SELECT slug, published_at FROM items
       WHERE status IN ('PUBLISHED','DISTRIBUTED') AND slug IS NOT NULL
       ORDER BY published_at DESC LIMIT 50000`,
    ),
    // Latest published_at per category — drives lastmod on /category/<slug>.
    query<{ category: string; latest: string | null }>(
      `SELECT category, MAX(published_at) AS latest FROM items
       WHERE status IN ('PUBLISHED','DISTRIBUTED') AND category IS NOT NULL
       GROUP BY category`,
    ),
    getTopTags(200),
    // Themes (curated) + top sources + trending keywords. Same enumeration
    // the topic page uses for generateStaticParams, so the two stay in sync.
    listKnownTopicSlugs({ sources: 50, keywords: 100 }),
    // Newest publish — used as lastmod for the home and tag-index pages
    // since those surfaces aggregate everything.
    query<{ latest: string | null }>(
      `SELECT MAX(published_at) AS latest FROM items WHERE status IN ('PUBLISHED','DISTRIBUTED')`,
    ),
  ]);

  // Latest published_at per tag — JSON_TABLE unnest, same shape as getTopTags
  // but keyed on MAX(published_at) so tag URLs in the sitemap can carry an
  // accurate lastmod (helps crawlers prioritize re-fetching active tags).
  const tagLatestRows = await query<{ tag: string; latest: string | null }>(
    `SELECT jt.tag AS tag, MAX(i.published_at) AS latest
     FROM items i,
          JSON_TABLE(i.tags, '$[*]' COLUMNS (tag VARCHAR(128) CHARACTER SET utf8mb4 PATH '$')) jt
     WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND jt.tag IS NOT NULL AND TRIM(jt.tag) <> ''
     GROUP BY jt.tag`,
  );
  const tagLatest = new Map(tagLatestRows.map((r) => [r.tag, toIso(r.latest)]));
  const categoryLatest = new Map(categories.map((c) => [c.category, toIso(c.latest)]));
  const homeLastmod = toIso(globalLatest[0]?.latest);

  const urls: Array<{ loc: string; lastmod?: string; priority?: string }> = [
    { loc: `${SITE_URL}/`, lastmod: homeLastmod, priority: '1.0' },
    { loc: `${SITE_URL}/tag`, lastmod: homeLastmod, priority: '0.7' },

    // Compliance / about pages — low priority but should be indexable.
    { loc: `${SITE_URL}/about/terms`,   priority: '0.3' },
    { loc: `${SITE_URL}/about/privacy`, priority: '0.3' },
    { loc: `${SITE_URL}/about/dmca`,    priority: '0.3' },

    // Topic pages. Lastmod left off because the source/keyword scope is
    // computed on read and would require an extra query per slug.
    ...topicSlugs.map((slug) => ({
      loc: `${SITE_URL}/topic/${slug}`,
      lastmod: homeLastmod,
      priority: '0.6',
    })),

    // Categories — lastmod = newest article in that category.
    ...categories.map((c) => ({
      loc: `${SITE_URL}/category/${encodeURIComponent(c.category)}`,
      lastmod: categoryLatest.get(c.category),
      priority: '0.7',
    })),

    // Top tags — lastmod = newest article tagged with that tag.
    ...tags.map((t) => ({
      loc: `${SITE_URL}/tag/${encodeURIComponent(t.tag)}`,
      lastmod: tagLatest.get(t.tag),
      priority: '0.5',
    })),

    // Articles.
    ...articles.map((a) => ({
      loc: `${SITE_URL}/a/${a.slug}`,
      lastmod: toIso(a.published_at),
      priority: '0.8',
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}${
      u.priority ? `\n    <priority>${u.priority}</priority>` : ''
    }
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
