import Link from 'next/link';
import { query } from '../lib/db';

export const revalidate = 600;

interface FeedRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  cover_sizes: Record<string, string> | null;
  category: string | null;
  published_at: string | null;
  first_media: string | null;
}

interface CatRow {
  category: string;
  count: number;
}

export default async function Home() {
  const [latest, categories] = await Promise.all([
    query<FeedRow>(
      `SELECT i.id, i.slug, i.title, i.summary, i.cover_url, i.cover_sizes,
              i.category, i.published_at,
              r.media_urls[1] AS first_media
       FROM items i
       JOIN raw_items r ON r.id = i.raw_item_id
       WHERE i.status = 'PUBLISHED'
       ORDER BY i.published_at DESC LIMIT 24`,
    ),
    query<CatRow>(
      `SELECT category, COUNT(*)::int AS count FROM items
       WHERE status = 'PUBLISHED' AND category IS NOT NULL
       GROUP BY category ORDER BY count DESC`,
    ),
  ]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>内容中台</h1>
        <p style={{ color: '#6b7280', marginTop: 6 }}>9 个 Agent 的自动化内容流水线 · <Link href="/workbench" style={{ color: '#2563eb', fontWeight: 600 }}>工作台</Link> · <Link href="/admin" style={{ color: '#6b7280' }}>旧后台</Link></p>
      </header>

      {categories.length > 0 && (
        <nav style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((c) => (
            <Link key={c.category} href={`/category/${encodeURIComponent(c.category)}`} style={{ padding: '4px 12px', border: '1px solid #e5e7eb', borderRadius: 16, color: '#111827', textDecoration: 'none', fontSize: 13, background: '#fff' }}>
              {c.category} <span style={{ color: '#9ca3af' }}>· {c.count}</span>
            </Link>
          ))}
        </nav>
      )}

      {latest.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#f9fafb', borderRadius: 8, color: '#6b7280' }}>
          暂无已发布内容 · 去 <Link href="/admin">后台</Link> 启动采集流水线
        </div>
      ) : (
        <section style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {latest.map((a) => {
            const thumb = a.cover_sizes?.card ?? a.cover_url ?? a.first_media;
            return (
              <Link key={a.id} href={`/a/${a.slug}`} style={{ display: 'block', color: '#111827', textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', background: '#f3f4f6', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '3/2', background: '#f3f4f6' }} />
                )}
                <div style={{ padding: 14 }}>
                  {a.category && (
                    <span style={{ fontSize: 11, color: '#2563eb', marginBottom: 6, display: 'inline-block' }}>{a.category}</span>
                  )}
                  <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.4 }}>{a.title}</h2>
                  {a.summary && (
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {a.summary}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
