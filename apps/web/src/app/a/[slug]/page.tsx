import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { cached } from '../../../lib/cache';
import { getRelated, getMoreFromAuthor, readMinutes } from '../../../lib/feed';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { proxiedImage, proxiedMedia } from '../../../lib/media';
import { stripUrlsFromHtml, stripCaptionParagraphs, stripSpamParagraphs, stripTitleArtifacts, cleanTagList, displayTitle } from '../../../lib/strip-urls';
import { virtualBlogger } from '../../../lib/virtual-blogger';
import { JsonLd } from '../../_components/JsonLd';
import { ArticleCard } from '../../_components/ArticleCard';
import { AdSlot } from '../../_components/AdSlot';
import { CTAModule } from '../../_components/CTAModule';
import { ImageLightbox } from '../../_components/ImageLightbox';
import { PvBeacon } from '../../_components/PvBeacon';
import { LikeButton } from '../../_components/LikeButton';
import { CommentSection } from '../../_components/CommentSection';
import { XLayout } from '../../_components/XLayout';
import { XFeedHeader } from '../../_components/XFeedHeader';

// Scoped overrides so RSS-cleaned content_html (which often carries inline
// light-theme styles) blends into the B1 dark reader. Targets only the
// article element, never bleeds into siblings.
const ARTICLE_CSS = `
  .article-body { color: #0f1419; }
  .article-body a { color: #1d9bf0; text-decoration: none; }
  .article-body a:hover { text-decoration: underline; }
  .article-body h1, .article-body h2, .article-body h3, .article-body h4 { color: #0f1419; }
  .article-body blockquote {
    border-left: 4px solid #1d9bf0;
    padding: 10px 16px;
    background: #ffffff;
    color: #536471;
    margin: 14px 0;
    border-radius: 0 12px 12px 0;
  }
  .article-body code {
    background: #ffffff;
    padding: 2px 7px;
    border-radius: 4px;
    color: #fbbf24;
    font-size: 0.92em;
    border: 1px solid #eff3f4;
  }
  .article-body pre {
    background: #ffffff;
    border: 1px solid #eff3f4;
    padding: 14px 16px;
    border-radius: 12px;
    overflow-x: auto;
    color: #0f1419;
  }
  .article-body img { background: #ffffff; border-radius: 12px; width: 100%; max-width: 100%; height: auto; display: block; margin: 16px auto; cursor: zoom-in; }
  .lightbox-img { cursor: zoom-in; }
  .article-body video { width: 100%; max-width: 100%; height: auto; display: block; margin: 16px auto; border-radius: 12px; }
  .article-body hr { border: 0; border-top: 1px solid #eff3f4; margin: 24px 0; }
  .article-body table { border-collapse: collapse; }
  .article-body th, .article-body td { border: 1px solid #eff3f4; padding: 6px 10px; }
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
  /** sources.platform — manual 源直接用 source.name 当公开博主名,
   *  其他平台走 virtualBlogger 哈希化名。 */
  source_platform: string | null;
  /** sources.avatar_url — 文章详情头部小头像用。 */
  source_avatar: string | null;
  url: string;
  media_urls: string[];
  video_urls: string[];
  /** 视频播放时长(秒)— 由 ingestion 阶段 ffprobe 写入 items.duration_sec。
   *  视频文章顶部 meta 行用它替代"X 分钟阅读";非视频文章为 NULL,回退到
   *  按字数估算的 readMinutes。 */
  duration_sec: number | null;
  /** 已点赞总数 — SSR 时直读列。客户端 LikeButton 挂载后会自校验。 */
  likes: number;
}

async function loadArticle(slug: string): Promise<Article | null> {
  // 文章页冷启动 ~22s,主要是 3 表 JOIN 远程查;slug 改动只发生在 publishing
  // 阶段,缓存 60s 既贴近 force-dynamic 的"实时"语义,又把热门文章的重复
  // 访问压回 100ms 级。
  return cached(`article:${slug}`, 60, async () => {
    const rows = await query<Article>(
      `SELECT i.id, i.slug, i.title, i.summary, i.content, i.content_html,
              i.category, i.tags, i.keywords, i.cover_url, i.cover_sizes,
              i.published_at, COALESCE(s.display_name, s.name) AS source, s.platform AS source_platform, s.avatar_url AS source_avatar,
              i.source_id, r.url,
              r.media_urls, r.video_urls, i.duration_sec, i.likes
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
    // mysql2 把 DATETIME 列默认返成 JS Date。类型声明是 string,SSR 时 React 把
    // Date 当 prop 隐式 toString() 渲染,hydration client 端发现类型不匹配会
    // 报 "tree hydrated but some attributes didn't match"。统一拍扁成 ISO 字符串。
    if (a.published_at && typeof a.published_at !== 'string') {
      a.published_at = new Date(a.published_at as any).toISOString();
    }
    return a;
  });
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
    return `<a href="${href}" style="color:#1d9bf0;text-decoration:none;">${hash}${name}</a>`;
  });
}

/** 秒数 → "M:SS" 或 "H:MM:SS" 的视频时长格式(同 YouTube/Tube 站惯例)。
 *  和卡片右下角时长 overlay 用同一格式,保持站内一致。 */
function formatDurationLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
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
  // 并发取"同主题"(getRelated) + "同作者"(getMoreFromAuthor)。两者
  // 视觉上是不同维度的推荐:同主题横向探索, 同作者纵向深耕,X profile 的
  // "Posts" tab 就是后者。两者各占一栏放在文章末尾。
  const [relatedRaw, moreFromAuthorRaw] = await Promise.all([
    getRelated(a.category, a.id, 12, relatedKind),
    getMoreFromAuthor(a.source_id, a.id, 6),
  ]);
  // 两区交叉去重 + 标题级别再过一道(SQL 里已经按 id 去重一次, 这里防御性):
  //   - "更多来自该博主" 优先, 同条不进入 "相关推荐"
  //   - 同标题在两区合起来只展示一次
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const normTitle = (t: string) => (t ?? '').trim().toLowerCase();
  const moreFromAuthor = moreFromAuthorRaw.filter((r) => {
    const tk = normTitle(r.title);
    if (seenIds.has(r.id) || (tk && seenTitles.has(tk))) return false;
    seenIds.add(r.id);
    if (tk) seenTitles.add(tk);
    return true;
  });
  const related = relatedRaw.filter((r) => {
    const tk = normTitle(r.title);
    if (seenIds.has(r.id) || (tk && seenTitles.has(tk))) return false;
    seenIds.add(r.id);
    if (tk) seenTitles.add(tk);
    return true;
  });
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

  // 视频文章顶部 meta 行用真实播放时长 "X:SS" 替代按字数估算的"分钟阅读"。
  // 视频帖子 content 通常只是一句话(<20 字), readMinutes 永远返回 1,
  // 显示"1 分钟阅读"对视频读者毫无信息量;改用 DB 里 ffprobe 抓的真实
  // duration_sec, 跟列表卡右下角的时长 overlay 一致。
  const durationSec = isVideoPost && a.duration_sec && a.duration_sec > 0
    ? a.duration_sec
    : null;
  const mediaTimeLabel = durationSec != null
    ? formatDurationLabel(durationSec)
    : `${minutes} 分钟阅读`;

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
    // Author:爬虫源走哈希化名,手工源用 a.source(运营选定的名字)。
    author: { '@type': 'Organization', name: virtualBlogger(a.source_id, { platform: a.source_platform, name: a.source }).name },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    inLanguage: 'zh-CN',
    isAccessibleForFree: true,
    articleSection: a.category ?? undefined,
    keywords: a.keywords.length ? a.keywords.join(', ') : undefined,
    wordCount: wordCount > 0 ? wordCount : undefined,
    // ISO 8601 duration:视频用真实播放秒数(PT5M32S),文章用估算分钟(PT4M)。
    timeRequired: durationSec != null
      ? `PT${Math.floor(durationSec / 60)}M${durationSec % 60}S`
      : `PT${minutes}M`,
  };

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    ...(a.category ? [{ name: a.category, url: `${SITE_URL}/category/${encodeURIComponent(a.category)}` }] : []),
    { name: cleanTitleForSchema, url: `${SITE_URL}/a/${a.slug}` },
  ];

  return (
    <XLayout active="home">
      <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />
      <XFeedHeader title={a.category ?? '文章'} back fallbackHref="/" />
      <div className="x-article" style={{ padding: '20px 24px 40px', lineHeight: 1.85 }}>
        <JsonLd data={jsonLd} />
        <JsonLd data={breadcrumbJsonLd(crumbs)} />

        <h1 style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, color: '#0f1419' }}>{displayTitle(a.title) || (a.category ? `${a.category} · 无标题内容` : '无标题内容')}</h1>

        <div style={{ fontSize: 14, color: '#536471', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {/* 完整发布时间 — 精确到分钟,跟原平台(X 的 legacy.created_at)对齐。
              手工 pad 出 "YYYY-MM-DD HH:mm" 24h 格式;部分 Node ICU 配置下
              toLocaleString('zh-CN', { hour12: false }) 仍会带"下午"前缀。 */}
          {a.published_at && (() => {
            const d = new Date(a.published_at);
            const p2 = (n: number) => String(n).padStart(2, '0');
            const txt = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
            // mysql2 把 DATETIME 列返回成 Date 对象, dateTime={Date} 会 SSR 时 toString()
            // 成 "Wed May 20 2026 ..."(浏览器时区),client hydration 比对就 mismatch。
            // 显式 toISOString() 拿稳定的机读格式,server / client 一致。
            return <time dateTime={d.toISOString()}>{txt}</time>;
          })()}
          <span>· {durationSec != null ? `视频 ${mediaTimeLabel}` : mediaTimeLabel}</span>
        </div>

        {/* 点赞按钮 — 客户端组件,挂载后自查 likes / liked 状态,显示乐观更新。
            SSR 时直接拿 items.likes,刷新页面立刻看见当前总数,不依赖 JS. */}
        <div style={{ marginBottom: 24 }}>
          <LikeButton slug={a.slug} initialLikes={a.likes ?? 0} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <AdSlot name="before-content" />
        </div>

        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          (<img src={proxiedImage(ogImage, a.source_id)} alt={stripTitle(a.title)} className="lightbox-img" data-full={proxiedImage(a.cover_sizes?.full ?? a.cover_sizes?.og ?? ogImage, a.source_id)} style={{ width: '100%', maxWidth: 960, aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 12, marginBottom: 24, background: '#ffffff', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />)
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
          // 媒体帖(视频 / 图片):标题已经在 h1 显示,正文里的 <p> 基本都是
          // 同一句话的重复(爬虫源的 content 直接拷自 title 文案)。
          // 整个 article-body 跳过,不靠正则 strip 兜底。
          if (hasVideo || isImagePost) return null;

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
                // Each video gets a relative wrapper so we can pin the
                // LikeButton overlay to its bottom-right. Only the FIRST
                // video carries the overlay — multiple buttons would compete
                // for the same items.likes counter and confuse the user.
                <div key={i} style={{ position: 'relative', maxWidth: 960, marginLeft: 'auto', marginRight: 'auto', width: '100%' }}>
                  <video
                    src={proxiedMedia(v.src) ?? v.src}
                    controls
                    preload="metadata"
                    playsInline
                    poster={proxiedImage(v.poster, a.source_id)}
                    style={{ width: '100%', maxHeight: 720, height: 'auto', borderRadius: 12, background: '#ffffff', display: 'block' }}
                  />
                  {i === 0 && (
                    // Right-bottom overlay. `bottom: 60px` keeps it clear of
                    // the native controls strip (~48px) when the user hovers
                    // / plays. backdrop-blur + translucent bg so it stays
                    // readable on both dark and bright video frames.
                    <div style={{
                      position: 'absolute',
                      right: 12,
                      bottom: 60,
                      zIndex: 2,
                      padding: 4,
                      borderRadius: 9999,
                      background: 'rgba(0, 0, 0, 0.45)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                    }}>
                      <LikeButton slug={a.slug} initialLikes={a.likes ?? 0} />
                    </div>
                  )}
                </div>
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
                  style={{ width: '100%', maxWidth: 960, height: 'auto', borderRadius: 12, background: '#ffffff', display: 'block', marginLeft: 'auto', marginRight: 'auto', cursor: 'zoom-in' }} />)
              ))}
            </div>
          </section>
        )}

        {a.tags.length > 0 && (
          <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #eff3f4', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#536471', marginRight: 4, fontWeight: 600 }}>标签</span>
            {/* 去重防同标签多次出现(LLM 偶尔会在 tags 和 keywords 里都吐同一个词,
                两列被合并到 cleanTagList 后没做最终 dedupe)。同时不再加 # 前缀,
                跟 /search、/tag、右栏热门标签三处的视觉对齐:直接显示文本。 */}
            {Array.from(new Set(a.tags)).map((t) => (
              <Link key={t} href={`/tag/${encodeURIComponent(t)}`} style={{
                display: 'inline-block',
                fontSize: 13,
                padding: '4px 12px',
                background: '#ffffff',
                border: '1px solid #cfd9de',
                color: '#0f1419',
                borderRadius: 9999,
                textDecoration: 'none',
                fontWeight: 500,
              }}>{t}</Link>
            ))}
          </div>
        )}

        {/* 合并评论区:本站匿名 + X 同步两路混排, X 来源加「来自 X」徽标。
            表单只发本站匿名评论, X 评论是镜像不允许从这里回写。 */}
        <CommentSection slug={a.slug} sourceId={a.source_id} />

        {/* "更多来自该博主" — X profile 风格的同作者纵向推荐。在"相关"
            之前出现,因为读者对当前作者的兴趣度通常 > 同主题随机文章。
            6 条上限,3 列网格(比相关推荐少一行高度,视觉上不抢焦点)。 */}
        {moreFromAuthor.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 20, marginBottom: 14, color: '#0f1419', fontWeight: 800 }}>
              更多来自 <Link href={`/topic/source-${a.source_id}`} style={{ color: '#1d9bf0', textDecoration: 'none' }}>
                {virtualBlogger(a.source_id, { platform: a.source_platform, name: a.source }).name}
              </Link>
            </h2>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {moreFromAuthor.map((r) => <ArticleCard key={r.id} a={r} />)}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 20, marginBottom: 14, color: '#0f1419', fontWeight: 800 }}>相关推荐</h2>
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
      </div>
      <ImageLightbox />
      <PvBeacon slug={a.slug} />
    </XLayout>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 13,
      color: '#536471',
      fontWeight: 700,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      margin: '0 0 12px',
    }}>{children}</h2>
  );
}
