import Link from 'next/link';
import { query } from '../lib/db';
import { SiteHeader } from './_components/SiteHeader';
import { CategoryNav } from './_components/CategoryNav';

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

export default async function Home() {
  const latest = await query<FeedRow>(
    `SELECT i.id, i.slug, i.title, i.summary, i.cover_url, i.cover_sizes,
            i.category, i.published_at,
            r.media_urls->>'$[0]' AS first_media
     FROM items i
     JOIN raw_items r ON r.id = i.raw_item_id
     WHERE i.status = 'PUBLISHED'
     ORDER BY i.published_at DESC LIMIT 24`,
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader />

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <header style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#e2e8f0' }}>内容中台</h1>
          <p style={{ color: '#94a3b8', marginTop: 6, fontSize: 14 }}>9 个 Agent 的自动化内容流水线</p>
        </header>

        <CategoryNav />

        {latest.length === 0 ? (
          <div style={{
            padding: 40,
            textAlign: 'center',
            background: '#1e293b',
            border: '1px dashed #334155',
            borderRadius: 8,
            color: '#94a3b8',
          }}>
            暂无已发布内容 · 去 <Link href="/admin" style={{ color: '#a5b4fc' }}>后台</Link> 启动采集流水线
          </div>
        ) : (
          <section style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {latest.map((a) => {
              const thumb = a.cover_sizes?.card ?? a.cover_url ?? a.first_media;
              return (
                <Link key={a.id} href={`/a/${a.slug}`} style={{
                  display: 'block',
                  color: '#e2e8f0',
                  textDecoration: 'none',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#1e293b',
                }}>
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', background: '#0f172a', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '3/2', background: '#0f172a' }} />
                  )}
                  <div style={{ padding: 14 }}>
                    {a.category && (
                      <span style={{ fontSize: 11, color: '#a5b4fc', marginBottom: 6, display: 'inline-block' }}>{a.category}</span>
                    )}
                    <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.4, color: '#e2e8f0' }}>{a.title}</h2>
                    {a.summary && (
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
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
    </div>
  );
}
