import { query, SITE_URL } from '../../lib/db';

export const revalidate = 600;

export async function GET() {
  const [articles, categories] = await Promise.all([
    query<{ slug: string; published_at: string | null }>(
      `SELECT slug, published_at FROM items
       WHERE status = 'PUBLISHED' AND slug IS NOT NULL
       ORDER BY published_at DESC LIMIT 50000`,
    ),
    query<{ category: string }>(
      `SELECT DISTINCT category FROM items
       WHERE status = 'PUBLISHED' AND category IS NOT NULL`,
    ),
  ]);

  const urls: Array<{ loc: string; lastmod?: string; priority?: string }> = [
    { loc: `${SITE_URL}/`, priority: '1.0' },
    ...categories.map((c) => ({
      loc: `${SITE_URL}/category/${encodeURIComponent(c.category)}`,
      priority: '0.7',
    })),
    ...articles.map((a) => ({
      loc: `${SITE_URL}/a/${a.slug}`,
      lastmod: a.published_at ? new Date(a.published_at).toISOString() : undefined,
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
      'Cache-Control': 's-maxage=600, stale-while-revalidate=3600',
    },
  });
}
