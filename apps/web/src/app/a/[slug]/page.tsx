import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';

export const revalidate = 3600; // fallback ISR; Publishing Agent triggers on-demand revalidation
export const dynamicParams = false;

/** Static-export hook: enumerate every PUBLISHED slug at build time. */
export async function generateStaticParams() {
  const rows = await query<{ slug: string }>(
    `SELECT slug FROM items WHERE status = 'PUBLISHED' AND slug IS NOT NULL`,
  );
  return rows.map((r) => ({ slug: r.slug }));
}

interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content: string | null;
  content_html: string | null;
  category: string | null;
  tags: string[];
  keywords: string[];
  cover_url: string | null;
  cover_sizes: Record<string, string> | null;
  published_at: string | null;
  source: string;
  url: string;
  media_urls: string[];
}

interface Related {
  id: string;
  slug: string;
  title: string;
  cover_url: string | null;
  category: string | null;
}

async function loadArticle(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT i.id, i.slug, i.title, i.summary, i.content, i.content_html,
            i.category, i.tags, i.keywords, i.cover_url, i.cover_sizes,
            i.published_at, s.name AS source, r.url,
            COALESCE(r.media_urls, '{}') AS media_urls
     FROM items i
     JOIN sources s ON s.id = i.source_id
     JOIN raw_items r ON r.id = i.raw_item_id
     WHERE i.slug = $1 AND i.status = 'PUBLISHED'
     LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

async function loadRelated(category: string | null, excludeId: string): Promise<Related[]> {
  if (!category) return [];
  return query<Related>(
    `SELECT id, slug, title, cover_url, category FROM items
     WHERE status = 'PUBLISHED' AND category = $1 AND id <> $2
     ORDER BY published_at DESC
     LIMIT 5`,
    [category, excludeId],
  );
}

export async function generateMetadata(
  { params }: { params: { slug: string } },
): Promise<Metadata> {
  const a = await loadArticle(params.slug);
  if (!a) return { title: `未找到 - ${SITE_NAME}` };
  const ogImage = a.cover_sizes?.og ?? a.cover_url ?? a.media_urls?.[0] ?? undefined;
  const canonical = `${SITE_URL}/a/${a.slug}`;
  return {
    title: `${a.title} - ${SITE_NAME}`,
    description: a.summary ?? undefined,
    keywords: a.keywords.length ? a.keywords : undefined,
    alternates: { canonical },
    openGraph: {
      title: a.title,
      description: a.summary ?? undefined,
      url: canonical,
      siteName: SITE_NAME,
      type: 'article',
      locale: 'zh_CN',
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined,
      publishedTime: a.published_at ?? undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: a.title,
      description: a.summary ?? undefined,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const a = await loadArticle(params.slug);
  if (!a) notFound();

  const related = await loadRelated(a.category, a.id);
  // Fall back to the first crawled media URL when cover agent hasn't set one.
  const ogImage = a.cover_sizes?.og ?? a.cover_url ?? a.media_urls?.[0] ?? undefined;
  const galleryRest = (a.media_urls ?? []).slice(ogImage === a.media_urls?.[0] ? 1 : 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.summary,
    image: ogImage ? [ogImage] : undefined,
    datePublished: a.published_at,
    dateModified: a.published_at,
    mainEntityOfPage: `${SITE_URL}/a/${a.slug}`,
    publisher: { '@type': 'Organization', name: SITE_NAME },
    keywords: a.keywords.join(', '),
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif', lineHeight: 1.7, color: '#111827' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav style={{ fontSize: 13, marginBottom: 20, color: '#6b7280' }}>
        <Link href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>首页</Link>
        {a.category && (
          <>
            {' › '}
            <Link href={`/category/${encodeURIComponent(a.category)}`} style={{ color: '#6b7280', textDecoration: 'none' }}>
              {a.category}
            </Link>
          </>
        )}
      </nav>

      <h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>{a.title}</h1>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
        {a.published_at && <span>{new Date(a.published_at).toLocaleDateString('zh-CN')}</span>}
        {' · '}来源:{a.source}
        {' · '}
        <a href={a.url} target="_blank" rel="nofollow noreferrer" style={{ color: '#6b7280' }}>原文</a>
      </div>

      {ogImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ogImage} alt="" style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 8, marginBottom: 24, background: '#f3f4f6' }} />
      )}

      {a.summary && (
        <p style={{ fontSize: 16, color: '#4b5563', background: '#f9fafb', borderLeft: '3px solid #111827', padding: '12px 16px', margin: '0 0 24px', borderRadius: 4 }}>
          {a.summary}
        </p>
      )}

      {a.content_html ? (
        <article
          style={{ fontSize: 16 }}
          dangerouslySetInnerHTML={{ __html: a.content_html }}
        />
      ) : (
        <article style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{a.content}</article>
      )}

      {galleryRest.length > 0 && (
        <section style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {galleryRest.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" loading="lazy"
              style={{ width: '100%', height: 'auto', borderRadius: 6, background: '#f3f4f6' }} />
          ))}
        </section>
      )}

      {a.tags.length > 0 && (
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>标签:</span>{' '}
          {a.tags.map((t) => (
            <span key={t} style={{ display: 'inline-block', fontSize: 12, padding: '2px 8px', background: '#f3e8ff', borderRadius: 10, marginRight: 6 }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>相关文章</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {related.map((r) => (
              <li key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                <Link href={`/a/${r.slug}`} style={{ color: '#111827', textDecoration: 'none' }}>
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
