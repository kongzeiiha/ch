import type { Metadata } from 'next';
import Link from 'next/link';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { SiteHeader } from '../../_components/SiteHeader';
import { CategoryNav } from '../../_components/CategoryNav';

export const revalidate = 3600;
export const dynamicParams = false;

/** Static-export hook: enumerate every distinct PUBLISHED category. */
export async function generateStaticParams() {
  const rows = await query<{ category: string }>(
    `SELECT DISTINCT category FROM items
     WHERE status = 'PUBLISHED' AND category IS NOT NULL`,
  );
  return rows.map((r) => ({ slug: encodeURIComponent(r.category) }));
}

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  cover_sizes: Record<string, string> | null;
  published_at: string | null;
}

async function loadCategory(category: string): Promise<ArticleRow[]> {
  return query<ArticleRow>(
    `SELECT id, slug, title, summary, cover_url, cover_sizes, published_at
     FROM items
     WHERE status = 'PUBLISHED' AND category = $1
     ORDER BY published_at DESC
     LIMIT 50`,
    [category],
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const category = decodeURIComponent(params.slug);
  return {
    title: `${category} - ${SITE_NAME}`,
    description: `${category} 分类下的最新文章`,
    alternates: { canonical: `${SITE_URL}/category/${params.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const category = decodeURIComponent(params.slug);
  const items = await loadCategory(category);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={category} />

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px' }}>
        <CategoryNav active={category} />

        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 20, color: '#e2e8f0' }}>{category}</h1>

        {items.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>该分类下暂无文章</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
            {items.map((a) => {
              const thumb = a.cover_sizes?.card ?? a.cover_url;
              return (
                <li key={a.id} style={{
                  display: 'flex',
                  gap: 16,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#1e293b',
                }}>
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 4, background: '#0f172a', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/a/${a.slug}`} style={{ color: '#e2e8f0', textDecoration: 'none' }}>
                      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 6px' }}>{a.title}</h2>
                    </Link>
                    {a.summary && (
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {a.summary}
                      </p>
                    )}
                    {a.published_at && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {new Date(a.published_at).toLocaleDateString('zh-CN')}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
