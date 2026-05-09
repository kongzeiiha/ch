import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { getRelated, readMinutes } from '../../../lib/feed';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { proxiedImage, proxiedMedia } from '../../../lib/media';
import { SiteHeader } from '../../_components/SiteHeader';
import { JsonLd } from '../../_components/JsonLd';
import { ArticleCard } from '../../_components/ArticleCard';
import { AdSlot } from '../../_components/AdSlot';
import { CTAModule } from '../../_components/CTAModule';
import { SiteFooter } from '../../_components/SiteFooter';

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

// 文章页也走 force-dynamic — publishing 完成的瞬间访问 /a/<slug> 就能看到,
// 不再需要等 revalidatePath 触发或 1 小时 ISR 兜底。代价是每次浏览都要查 DB,
// 流量大时再考虑切回 generateStaticParams + revalidatePath。
export const dynamic = 'force-dynamic';

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
  /** Source UUID — needed to drive platform-aware Referer/Cookie headers in
   *  the public /img-proxy when fetching X-CDN / 2ksg / knit posters. */
  source_id: string;
  url: string;
  media_urls: string[];
  video_urls: string[];
}

async function loadArticle(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT i.id, i.slug, i.title, i.summary, i.content, i.content_html,
            i.category, i.tags, i.keywords, i.cover_url, i.cover_sizes,
            i.published_at, s.name AS source, i.source_id, r.url,
            r.media_urls, r.video_urls
     FROM items i
     JOIN sources s ON s.id = i.source_id
     JOIN raw_items r ON r.id = i.raw_item_id
     WHERE i.slug = $1 AND i.status IN ('PUBLISHED','DISTRIBUTED')
     LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

/** Next.js 15 leaves the URL-encoded form on `params.slug` for non-ASCII
 *  segments (unlike Next 14 which auto-decoded). We always work with the
 *  decoded form so it matches MySQL's utf8mb4 storage. Wrapped in try/catch
 *  because malformed `%xx` sequences from spam crawlers would otherwise 500. */
function decodedSlug(slug: string): string {
  try { return decodeURIComponent(slug); } catch { return slug; }
}

/** Look up an old slug (pre-CJK migration) → new slug, for 301 redirects.
 *  Returns null if the legacy slug doesn't exist or already maps to itself
 *  (which shouldn't happen because backfill stamps legacy_slug = old). */
async function resolveLegacySlug(slug: string): Promise<string | null> {
  const rows = await query<{ slug: string }>(
    `SELECT slug FROM items
     WHERE legacy_slug = $1 AND slug <> $1 AND status IN ('PUBLISHED','DISTRIBUTED')
     LIMIT 1`,
    [slug],
  );
  return rows[0]?.slug ?? null;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;

type MediaItem =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string; poster?: string };

/** Classify each parallel-indexed (media_urls[i], video_urls[i]) pair:
 *    1. media_urls[i] ends in a video extension → standalone video, no poster
 *    2. video_urls[i] is set                    → media_urls[i] is the poster jpg, sidecar is playable
 *    3. else                                    → plain image
 *  Plus any video_urls beyond the media_urls length get included as poster-less videos. */
// Convert `#tag` mentions in article body into real `<a href="/tag/<tag>">` —
// boosts internal link density without manual editing. Matches both fullwidth
// `＃` (used by some CN platforms) and plain `#`. Only safe to apply to text
// content or `content_html` because we know the upstream feed is HTML where
// the # tokens live in text nodes, not inside attribute values.
const TAG_RE = /([#＃])([一-龥A-Za-z0-9_ぁ-ー]{1,32})/g;
function linkifyTags(text: string, knownTags: string[]): string {
  if (!text) return text;
  // Build an exact-match set so we only link tokens the article actually
  // declared as a tag (avoids linking arbitrary `#中文` strings that happen
  // to appear in body text).
  const allow = new Set(knownTags);
  return text.replace(TAG_RE, (_full, hash, name) => {
    if (!allow.has(name)) return `${hash}${name}`;
    const href = `/tag/${encodeURIComponent(name)}`;
    return `<a href="${href}" style="color:#a5b4fc;text-decoration:none;">${hash}${name}</a>`;
  });
}

function classifyMedia(media: string[], videos: string[]): MediaItem[] {
  const out: MediaItem[] = [];
  const m = media ?? [];
  const v = videos ?? [];
  for (let i = 0; i < m.length; i++) {
    const url = m[i]!;
    if (VIDEO_EXT.test(url)) { out.push({ kind: 'video', src: url }); continue; }
    const sidecar = v[i];
    if (sidecar) { out.push({ kind: 'video', src: sidecar, poster: url }); continue; }
    out.push({ kind: 'image', src: url });
  }
  for (let i = m.length; i < v.length; i++) {
    out.push({ kind: 'video', src: v[i]! });
  }
  return out;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const a = await loadArticle(decodedSlug(params.slug));
  if (!a) return { title: '未找到' };
  const ogImage = a.cover_sizes?.og ?? a.cover_url ?? a.media_urls?.[0] ?? undefined;
  const canonical = `${SITE_URL}/a/${a.slug}`;
  // Trim summary for the meta description so SERP isn't truncated mid-sentence.
  // ~150 chars is Google's display ceiling on most devices.
  const desc = a.summary
    ? a.summary.length > 150 ? `${a.summary.slice(0, 147)}...` : a.summary
    : (a.title.length > 150 ? `${a.title.slice(0, 147)}...` : a.title);
  return {
    title: a.title.length > 70 ? `${a.title.slice(0, 67)}...` : a.title,
    description: desc,
    keywords: a.keywords.length ? a.keywords : undefined,
    alternates: { canonical },
    robots: ROBOTS_INDEXABLE,
    openGraph: {
      title: a.title,
      description: a.summary ?? undefined,
      url: canonical,
      siteName: SITE_NAME,
      type: 'article',
      locale: 'zh_CN',
      images: ogImages(ogImage),
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

export default async function ArticlePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Next 15 passes the dynamic segment URL-encoded; we need the raw form to
  // match items.slug (which holds CJK chars verbatim in MySQL utf8mb4).
  const slug = decodedSlug(params.slug);
  const a = await loadArticle(slug);
  if (!a) {
    // 旧 URL → 308 to new canonical slug. The Location HTTP header is ASCII-
    // only so non-ASCII slugs (CJK URLs) MUST be encodeURIComponent'd before
    // we set the redirect target — otherwise Node throws ERR_INVALID_CHAR.
    const newSlug = await resolveLegacySlug(slug);
    if (newSlug) permanentRedirect(`/a/${encodeURIComponent(newSlug)}`);
    notFound();
  }

  const related = await getRelated(a.category, a.id, 6);
  // Cover: prefer cover agent output → first plain image in media_urls. Skip
  // entries that are videos or video posters so the hero doesn't render a
  // .mp4 URL as <img>.
  const allMedia = classifyMedia(a.media_urls ?? [], a.video_urls ?? []);
  const firstImageItem = allMedia.find((m) => m.kind === 'image');
  const firstImageUrl = firstImageItem?.kind === 'image' ? firstImageItem.src : undefined;
  const ogImage = a.cover_sizes?.og ?? a.cover_url ?? firstImageUrl ?? undefined;
  // Gallery items minus the cover (so cover doesn't render twice). Match by
  // image src; videos always render in the video section regardless.
  const galleryItems = allMedia.filter((m) => m.kind === 'video' || m.src !== ogImage);
  const galleryVideos = galleryItems.filter((m): m is Extract<MediaItem, { kind: 'video' }> => m.kind === 'video');
  const galleryImages = galleryItems.filter((m): m is Extract<MediaItem, { kind: 'image' }> => m.kind === 'image');
  const minutes = readMinutes((a.content ?? '').length);

  const wordCount = (a.content ?? '').length;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.summary,
    image: ogImage ? [ogImage] : undefined,
    datePublished: a.published_at,
    dateModified: a.published_at,
    mainEntityOfPage: `${SITE_URL}/a/${a.slug}`,
    // Source acts as both author and the original publisher; the platform itself
    // is the redistributing publisher and gets the Organization role.
    author: { '@type': 'Organization', name: a.source },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    inLanguage: 'zh-CN',
    isAccessibleForFree: true,
    articleSection: a.category ?? undefined,
    keywords: a.keywords.length ? a.keywords.join(', ') : undefined,
    wordCount: wordCount > 0 ? wordCount : undefined,
    timeRequired: `PT${minutes}M`,
  };

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    ...(a.category ? [{ name: a.category, url: `${SITE_URL}/category/${encodeURIComponent(a.category)}` }] : []),
    { name: a.title, url: `${SITE_URL}/a/${a.slug}` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={a.category ?? undefined} />
      <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px', lineHeight: 1.85 }}>
        <JsonLd data={jsonLd} />
        <JsonLd data={breadcrumbJsonLd(crumbs)} />

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

        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {a.published_at && <span>{new Date(a.published_at).toLocaleDateString('zh-CN')}</span>}
          <span>· {minutes} 分钟阅读</span>
          <span>· 来源:<span style={{ color: '#94a3b8' }}>{a.source}</span></span>
          <a href={a.url} target="_blank" rel="nofollow noreferrer" style={{ color: '#93c5fd' }}>· 原文 ↗</a>
        </div>

        <div style={{ marginBottom: 20 }}>
          <AdSlot name="before-content" />
        </div>

        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          (<img src={proxiedImage(ogImage, a.source_id)} alt={a.title} style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 8, marginBottom: 24, background: '#1e293b' }} />)
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
            dangerouslySetInnerHTML={{ __html: linkifyTags(a.content_html, a.tags) }}
          />
        ) : (
          <article
            className="article-body"
            style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}
            dangerouslySetInnerHTML={{ __html: linkifyTags(a.content ?? '', a.tags) }}
          />
        )}

        {galleryVideos.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <SectionLabel>视频 · {galleryVideos.length}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {galleryVideos.map((v, i) => (
                <video
                  key={i}
                  src={proxiedMedia(v.src) ?? v.src}
                  controls
                  preload="metadata"
                  playsInline
                  poster={proxiedImage(v.poster, a.source_id)}
                  style={{ width: '100%', height: 'auto', maxHeight: 540, borderRadius: 6, background: '#0f172a' }}
                />
              ))}
            </div>
          </section>
        )}

        {galleryImages.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <SectionLabel>图片 · {galleryImages.length}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {galleryImages.map((m, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                (<img key={i} src={proxiedImage(m.src, a.source_id)} alt={`${a.title} - 图片 ${i + 1}`} loading="lazy"
                  style={{ width: '100%', height: 'auto', borderRadius: 6, background: '#1e293b' }} />)
              ))}
            </div>
          </section>
        )}

        {a.tags.length > 0 && (
          <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #334155', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b', marginRight: 4 }}>标签</span>
            {a.tags.map((t) => (
              <Link key={t} href={`/tag/${encodeURIComponent(t)}`} style={{
                display: 'inline-block',
                fontSize: 12,
                padding: '2px 10px',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#cbd5e1',
                borderRadius: 10,
                textDecoration: 'none',
              }}>#{t}</Link>
            ))}
          </div>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 18, marginBottom: 14, color: '#e2e8f0' }}>相关推荐</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
              {related.map((r) => (
                <li key={r.id}><ArticleCard a={r} layout="row" /></li>
              ))}
            </ul>
          </section>
        )}

        <div style={{ marginTop: 32 }}>
          <AdSlot name="mid-content" />
        </div>

        <div style={{ marginTop: 28 }}>
          <CTAModule />
        </div>

        <div style={{ marginTop: 32 }}>
          <AdSlot name="footer" />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 12,
      color: '#64748b',
      fontWeight: 700,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      margin: '0 0 12px',
    }}>{children}</h2>
  );
}
