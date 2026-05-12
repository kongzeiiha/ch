import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { getRelated, readMinutes } from '../../../lib/feed';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { proxiedImage, proxiedMedia } from '../../../lib/media';
import { stripUrlsFromHtml, stripCaptionParagraphs, stripSpamParagraphs, stripTitleArtifacts, cleanTagList, displayTitle } from '../../../lib/strip-urls';
import { SiteHeader } from '../../_components/SiteHeader';
import { JsonLd } from '../../_components/JsonLd';
import { ArticleCard } from '../../_components/ArticleCard';
import { AdSlot } from '../../_components/AdSlot';
import { CTAModule } from '../../_components/CTAModule';
import { SiteFooter } from '../../_components/SiteFooter';
import { ImageLightbox } from '../../_components/ImageLightbox';
import { PvBeacon } from '../../_components/PvBeacon';

// Scoped overrides so RSS-cleaned content_html (which often carries inline
// light-theme styles) blends into the B1 dark reader. Targets only the
// article element, never bleeds into siblings.
const ARTICLE_CSS = `
  .article-body { color: #e2e8f0; }
  .article-body a { color: #dc2626; text-decoration: none; }
  .article-body a:hover { text-decoration: underline; }
  .article-body h1, .article-body h2, .article-body h3, .article-body h4 { color: #f1f5f9; }
  .article-body blockquote {
    border-left: 4px solid #dc2626;
    padding: 10px 16px;
    background: #000000;
    color: #94a3b8;
    margin: 14px 0;
    border-radius: 0 12px 12px 0;
  }
  .article-body code {
    background: #000000;
    padding: 2px 7px;
    border-radius: 4px;
    color: #fbbf24;
    font-size: 0.92em;
    border: 1px solid #1f2937;
  }
  .article-body pre {
    background: #000000;
    border: 1px solid #1f2937;
    padding: 14px 16px;
    border-radius: 12px;
    overflow-x: auto;
    color: #e2e8f0;
  }
  .article-body img { background: #000000; border-radius: 12px; width: 100%; max-width: 100%; height: auto; display: block; margin: 16px auto; cursor: zoom-in; }
  .lightbox-img { cursor: zoom-in; }
  .article-body video { width: 100%; max-width: 100%; height: auto; display: block; margin: 16px auto; border-radius: 12px; }
  .article-body hr { border: 0; border-top: 1px solid #1f2937; margin: 24px 0; }
  .article-body table { border-collapse: collapse; }
  .article-body th, .article-body td { border: 1px solid #1f2937; padding: 6px 10px; }
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
  const a = rows[0];
  if (!a) return null;
  // Filter LLM-artifact tags/keywords ("关键词《X》") + sentence-length junk
  // here so downstream surfaces (h1 strip is title-only, but tag chips,
  // <meta keywords>, JSON-LD keywords, content linkifyTags) all see clean
  // arrays. Matches feed.ts normalize() behavior on listing pages.
  a.tags = cleanTagList(a.tags);
  a.keywords = cleanTagList(a.keywords);
  return a;
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
// Titles/summaries get the heavier cleanup (URLs + @mentions + trailing
// LLM-label artifacts like "关键词《不洁之星》"). The article body itself
// goes through a separate strip pipeline (stripUrlsFromHtml +
// stripCaptionParagraphs + stripSpamParagraphs) plus an unconditional
// <p>-removal pass — see the body-rendering block below.
const stripTitle = stripTitleArtifacts;

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
    return `<a href="${href}" style="color:#dc2626;text-decoration:none;">${hash}${name}</a>`;
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
  // For articles whose title/summary are nothing but URLs/@mentions (junk
  // ingested from social posts that are pure media), fall back to a category
  // hint so SERP/OG don't display the bare URL. stripTitle additionally peels
  // off trailing LLM artifacts (关键词《XX》 / Keywords:…) that leaked from
  // classify-title — see lib/strip-urls.ts.
  const cleanedTitle = stripTitle(a.title);
  const cleanedSummary = stripTitle(a.summary ?? '');
  const titleForSerp = cleanedTitle || (a.category ? `${a.category} · 无标题内容` : '无标题内容');
  const trimmedTitle = titleForSerp.length > 70 ? `${titleForSerp.slice(0, 67)}...` : titleForSerp;
  // Trim description for SERP — Google truncates around 150 chars on mobile.
  const descSrc = cleanedSummary || cleanedTitle || titleForSerp;
  const desc = descSrc.length > 150 ? `${descSrc.slice(0, 147)}...` : descSrc;
  return {
    title: trimmedTitle,
    description: desc,
    keywords: a.keywords.length ? a.keywords : undefined,
    alternates: { canonical },
    robots: ROBOTS_INDEXABLE,
    openGraph: {
      title: titleForSerp,
      description: cleanedSummary || undefined,
      url: canonical,
      siteName: SITE_NAME,
      type: 'article',
      locale: 'zh_CN',
      images: ogImages(ogImage),
      publishedTime: a.published_at ?? undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: titleForSerp,
      description: cleanedSummary || undefined,
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

  // Cover: prefer cover agent output → first plain image in media_urls. Skip
  // entries that are videos or video posters so the hero doesn't render a
  // .mp4 URL as <img>.
  const allMedia = classifyMedia(a.media_urls ?? [], a.video_urls ?? []);
  // Decide which "relateds" to surface: if this article is a video post,
  // recommend other videos; if it's image-only, recommend images. Computed
  // BEFORE the getRelated call so it can be passed as the media filter.
  const isVideoPost = (a.video_urls?.length ?? 0) > 0 || allMedia.some((m) => m.kind === 'video');
  const isImagePost = !isVideoPost && (a.media_urls?.length ?? 0) > 0;
  const relatedKind: 'video' | 'image' | undefined = isVideoPost ? 'video' : isImagePost ? 'image' : undefined;
  const related = await getRelated(a.category, a.id, 12, relatedKind);
  const firstImageItem = allMedia.find((m) => m.kind === 'image');
  const firstImageUrl = firstImageItem?.kind === 'image' ? firstImageItem.src : undefined;
  // When an article has videos, the still images alongside are usually the
  // video poster duplicated in media_urls or unrelated thumbnails — both feel
  // redundant when the video itself is the headline content. Hide them
  // entirely (cover + gallery + inline) so the page reads as video-first.
  const hasVideo = allMedia.some((m) => m.kind === 'video');
  const ogImage = hasVideo ? undefined : (a.cover_sizes?.og ?? a.cover_url ?? firstImageUrl ?? undefined);
  // Gallery items minus the cover (so cover doesn't render twice). Match by
  // image src; videos always render in the video section regardless.
  const galleryItems = allMedia.filter((m) => m.kind === 'video' || m.src !== ogImage);
  const galleryVideos = galleryItems.filter((m): m is Extract<MediaItem, { kind: 'video' }> => m.kind === 'video');
  // Dedup gallery images. Two layers:
  //   1) URL stem — same image with different size suffixes / query strings:
  //      pbs.twimg.com/.../foo.jpg:large == foo.jpg?name=orig == foo.jpg
  //   2) cover-as-MinIO vs cover-as-source — when the cover agent has run,
  //      ogImage is the MinIO mirror (localhost:9000/...); the original CDN
  //      URL still sits in media_urls[0]. They're visually the same photo
  //      but their URL stems differ, so we explicitly add BOTH to the seen
  //      set: the rendered cover and the source it was derived from.
  const imageStem = (url: string): string =>
    url
      .split('?')[0]!
      .replace(/:[a-z]+$/i, '')                 // X CDN: ...jpg:large → ...jpg
      .replace(/_(?:small|medium|large|orig|\d{2,4}x\d{2,4})\.(?=jpg|jpeg|png|webp|gif)/i, '.') // foo_large.jpg → foo.jpg
      .toLowerCase();
  const seenStems = new Set<string>();
  if (ogImage) seenStems.add(imageStem(ogImage));
  if (firstImageUrl) seenStems.add(imageStem(firstImageUrl));
  // Also mark every cover_sizes variant (og/card/thumb/full) as seen — those
  // MinIO URLs share the same itemId path so this is mostly belt-and-braces
  // for sources that store multiple cover variants in different formats.
  if (a.cover_sizes) {
    for (const v of Object.values(a.cover_sizes)) {
      if (typeof v === 'string') seenStems.add(imageStem(v));
    }
  }
  const galleryImages = hasVideo
    ? []
    : galleryItems
        .filter((m): m is Extract<MediaItem, { kind: 'image' }> => m.kind === 'image')
        .filter((m) => {
          const stem = imageStem(m.src);
          if (seenStems.has(stem)) return false;
          seenStems.add(stem);
          return true;
        });
  const minutes = readMinutes((a.content ?? '').length);

  const wordCount = (a.content ?? '').length;
  // Title/summary surfaces that go into structured data / breadcrumbs also
  // get the LLM-artifact cleanup — Google's rich snippets and breadcrumb
  // crumbs will otherwise echo the same "关键词《XX》" tail the H1 just hid.
  const cleanTitleForSchema = stripTitle(a.title) || a.title;
  const cleanSummaryForSchema = stripTitle(a.summary ?? '') || a.summary;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: cleanTitleForSchema,
    description: cleanSummaryForSchema,
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
    { name: cleanTitleForSchema, url: `${SITE_URL}/a/${a.slug}` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#000000', color: '#e2e8f0' }}>
      <SiteHeader crumb={a.category ?? undefined} />
      <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px', lineHeight: 1.85 }}>
        <JsonLd data={jsonLd} />
        <JsonLd data={breadcrumbJsonLd(crumbs)} />

        <h1 style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, color: '#f1f5f9' }}>{displayTitle(a.title) || (a.category ? `${a.category} · 无标题内容` : '无标题内容')}</h1>

        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {a.published_at && <span>{new Date(a.published_at).toLocaleDateString('zh-CN')}</span>}
          <span>· {minutes} 分钟阅读</span>
        </div>

        <div style={{ marginBottom: 20 }}>
          <AdSlot name="before-content" />
        </div>

        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          (<img src={proxiedImage(ogImage, a.source_id)} alt={stripTitle(a.title)} className="lightbox-img" data-full={proxiedImage(a.cover_sizes?.full ?? a.cover_sizes?.og ?? ogImage, a.source_id)} style={{ width: '100%', maxWidth: 960, aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 12, marginBottom: 24, background: '#000000', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />)
        )}

        {/* Summary <p> intentionally hidden on the article page — it duplicates
            the body and often quotes loaded content verbatim. The summary still
            ships in the <meta description>, JSON-LD, and OG tags for SEO. */}

        {(() => {
          // Plain-text body has no real structural elements — it's just raw
          // text. The product call is "drop all paragraphs"; for plain-text
          // sources that means dropping everything. Skip the <article> block
          // entirely (matches HTML-body behavior of "no <p> after strip").
          if (!a.content_html) return null;

          // HTML body: build the cleaned markup, then unconditionally strip
          // every <p>...</p> before render. Per product call (X / Reddit
          // ingests are 100% social-post and the "body" is always a duplicate
          // of the title; readers don't want above-the-fold paragraphs that
          // just echo the H1). Other structural elements (<ul>/<blockquote>/
          // <pre>/etc.) still flow through, so a future longform source
          // isn't accidentally muted.
          const rawBody = linkifyTags(
            hasVideo
              ? stripUrlsFromHtml(a.content_html)
                  .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '')
                  .replace(/<p\b[^>]*>[\s\S]*?<img\b[\s\S]*?<\/p>/gi, '')
                  .replace(/<img\b[^>]*>/gi, '')
              : stripSpamParagraphs(
                  stripCaptionParagraphs(
                    stripUrlsFromHtml(a.content_html)
                      .replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/gi, ''),
                  ),
                ),
            a.tags,
          );

          // Drop every <p>...</p> block. The non-greedy [\s\S]*? keeps each
          // paragraph match local so non-<p> structural elements between
          // paragraphs aren't accidentally swallowed.
          const cleanedBody = rawBody.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '').trim();

          // After paragraph removal there might be only whitespace / empty
          // tags left. Skip rendering the <article> entirely in that case so
          // we don't show an empty bordered region.
          if (!cleanedBody.replace(/<[^>]+>/g, '').trim()) return null;

          return (
            <article
              className="article-body"
              style={{ fontSize: 16 }}
              dangerouslySetInnerHTML={{ __html: cleanedBody }}
            />
          );
        })()}

        {galleryVideos.length > 0 && (
          <section style={{ marginTop: 32 }}>
            {galleryVideos.length > 1 && <SectionLabel>视频 · {galleryVideos.length}</SectionLabel>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {galleryVideos.map((v, i) => (
                <video
                  key={i}
                  src={proxiedMedia(v.src) ?? v.src}
                  controls
                  preload="metadata"
                  playsInline
                  poster={proxiedImage(v.poster, a.source_id)}
                  style={{ width: '100%', maxWidth: 960, height: 'auto', maxHeight: 720, borderRadius: 12, background: '#000000', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
                />
              ))}
            </div>
          </section>
        )}

        {galleryImages.length > 0 && (
          <section style={{ marginTop: 32 }}>
            {galleryImages.length > 1 && <SectionLabel>图片 · {galleryImages.length}</SectionLabel>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {galleryImages.map((m, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                (<img key={i} src={proxiedImage(m.src, a.source_id)} alt={`${stripTitle(a.title)} - 图片 ${i + 1}`} loading="lazy" className="lightbox-img"
                  style={{ width: '100%', maxWidth: 960, height: 'auto', borderRadius: 12, background: '#000000', display: 'block', marginLeft: 'auto', marginRight: 'auto', cursor: 'zoom-in' }} />)
              ))}
            </div>
          </section>
        )}

        {a.tags.length > 0 && (
          <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #1f2937', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#94a3b8', marginRight: 4, fontWeight: 600 }}>标签</span>
            {a.tags.map((t) => (
              <Link key={t} href={`/tag/${encodeURIComponent(t)}`} style={{
                display: 'inline-block',
                fontSize: 13,
                padding: '4px 12px',
                background: '#000000',
                border: '1px solid #334155',
                color: '#e2e8f0',
                borderRadius: 9999,
                textDecoration: 'none',
                fontWeight: 500,
              }}>#{t}</Link>
            ))}
          </div>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 20, marginBottom: 14, color: '#f1f5f9', fontWeight: 800 }}>相关推荐</h2>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {related.map((r) => <ArticleCard key={r.id} a={r} />)}
            </div>
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
      <ImageLightbox />
      <PvBeacon slug={a.slug} />
      <SiteFooter />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 13,
      color: '#94a3b8',
      fontWeight: 700,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      margin: '0 0 12px',
    }}>{children}</h2>
  );
}
