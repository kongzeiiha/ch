import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { SiteHeader } from '../../_components/SiteHeader';

// Scoped overrides so RSS-cleaned content_html (which often carries inline
// light-theme styles) blends into the dark slate page. Targets only the
// article element, never bleeds into siblings.
const ARTICLE_CSS = `
  .article-body { color: #cbd5e1; }
  .article-body a { color: #93c5fd; }
  .article-body a:hover { color: #bfdbfe; }
  .article-body h1, .article-body h2, .article-body h3, .article-body h4 { color: #e2e8f0; }
  .article-body blockquote {
    border-left: 3px solid #6366f1;
    padding: 8px 14px;
    background: #0f172a;
    color: #cbd5e1;
    margin: 14px 0;
  }
  .article-body code {
    background: #0f172a;
    padding: 1px 6px;
    border-radius: 3px;
    color: #fbbf24;
    font-size: 0.92em;
  }
  .article-body pre {
    background: #020617;
    border: 1px solid #334155;
    padding: 12px 14px;
    border-radius: 6px;
    overflow-x: auto;
    color: #e2e8f0;
  }
  .article-body img { background: #0f172a; border-radius: 6px; max-width: 100%; height: auto; }
  .article-body hr { border: 0; border-top: 1px solid #334155; margin: 24px 0; }
  .article-body table { border-collapse: collapse; }
  .article-body th, .article-body td { border: 1px solid #334155; padding: 6px 10px; }
`;

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
            r.media_urls
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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={a.category ?? undefined} />
      <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px', lineHeight: 1.85 }}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <nav style={{ fontSize: 13, marginBottom: 20, color: '#64748b' }}>
          <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>首页</Link>
          {a.category && (
            <>
              {' › '}
              <Link href={`/category/${encodeURIComponent(a.category)}`} style={{ color: '#94a3b8', textDecoration: 'none' }}>
                {a.category}
              </Link>
            </>
          )}
        </nav>

        <h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3, marginBottom: 8, color: '#e2e8f0' }}>{a.title}</h1>

        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          {a.published_at && <span>{new Date(a.published_at).toLocaleDateString('zh-CN')}</span>}
          {' · '}来源:<span style={{ color: '#94a3b8' }}>{a.source}</span>
          {' · '}
          <a href={a.url} target="_blank" rel="nofollow noreferrer" style={{ color: '#93c5fd' }}>原文</a>
        </div>

        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ogImage} alt="" style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 8, marginBottom: 24, background: '#1e293b' }} />
        )}

        {a.summary && (
          <p style={{
            fontSize: 16,
            color: '#cbd5e1',
            background: '#1e293b',
            borderLeft: '3px solid #6366f1',
            padding: '12px 16px',
            margin: '0 0 24px',
            borderRadius: 4,
            lineHeight: 1.7,
          }}>
            {a.summary}
          </p>
        )}

        {a.content_html ? (
          <article
            className="article-body"
            style={{ fontSize: 16 }}
            dangerouslySetInnerHTML={{ __html: a.content_html }}
          />
        ) : (
          <article className="article-body" style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{a.content}</article>
        )}

        {galleryRest.length > 0 && (
          <section style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {galleryRest.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" loading="lazy"
                style={{ width: '100%', height: 'auto', borderRadius: 6, background: '#1e293b' }} />
            ))}
          </section>
        )}

        {a.tags.length > 0 && (
          <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #334155' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>标签:</span>{' '}
            {a.tags.map((t) => (
              <span key={t} style={{
                display: 'inline-block',
                fontSize: 12,
                padding: '2px 8px',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#cbd5e1',
                borderRadius: 10,
                marginRight: 6,
              }}>
                {t}
              </span>
            ))}
          </div>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 48 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12, color: '#e2e8f0' }}>相关文章</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {related.map((r) => (
                <li key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
                  <Link href={`/a/${r.slug}`} style={{ color: '#cbd5e1', textDecoration: 'none' }}>
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
