import Link from 'next/link';
import type { Metadata } from 'next';
import { getFiltered, type LengthBucket, type DateBucket } from '../lib/feed';
import { SITE_NAME, SITE_URL } from '../lib/db';
import { ROBOTS_INDEXABLE, ogImages } from '../lib/seo';
import { SiteHeader } from './_components/SiteHeader';
import { ArticleCard } from './_components/ArticleCard';
import { CategoryNav } from './_components/CategoryNav';
import { FilterBar } from './_components/FilterBar';
import { Pagination } from './_components/Pagination';
import { SiteFooter } from './_components/SiteFooter';
import { X } from './_components/theme';

// 站点列表页全部走 force-dynamic:每次请求直接查 MySQL,publishing
// 把 items.status 翻成 PUBLISHED 那一刻起,刷新页面就能看到。
export const dynamic = 'force-dynamic';

const SITE_DESC = '聚合多源精选内容,涵盖热门精选、最新更新、主题专区、标签导航,长尾关键词全方位覆盖。基于多 Agent 自动化流水线持续更新。';

export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  description: SITE_DESC,
  alternates: { canonical: `${SITE_URL}/` },
  robots: ROBOTS_INDEXABLE,
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESC,
    url: `${SITE_URL}/`,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'zh_CN',
    images: ogImages(),
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESC,
  },
};

interface SearchParams {
  tag?: string;
  category?: string;
  media?: 'video' | 'image';
  length?: LengthBucket;
  date?: DateBucket;
  sort?: 'latest' | 'hot';
  page?: string;
  [key: string]: string | undefined;
}

const PAGE_SIZE = 24;

// One unified view, three layered scopes:
//   1. media (none / video / image) — primary top-level tab
//   2. sort (hot / latest)           — sub-tab under each media scope
//   3. advanced filters (date/tag/length) — buried in FilterBar when filtered
//
// `/` defaults to media=undefined, sort=hot (i.e. 热门精选). The sub-tabs
// always toggle (hot↔latest) within the current media scope so the user
// stays "inside videos" / "inside images" when sorting.
export default async function Home(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  // Default sort is hot — site landing should be 热门精选 unless user explicitly
  // toggles 最新. This makes `/` and `/?sort=hot` render identical views and
  // collapses the old LandingView/FilteredView fork.
  const sort: 'latest' | 'hot' = searchParams.sort === 'latest' ? 'latest' : 'hot';
  const media = searchParams.media;

  const { items, total } = await getFiltered({
    tag: searchParams.tag,
    category: searchParams.category,
    media,
    length: searchParams.length,
    date: searchParams.date,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // Build header text + active tab key from current scope.
  const scopeLabel = media === 'video' ? '视频'
    : media === 'image' ? '图片'
    : '热门精选';
  const activeTab = media === 'video' ? 'videos'
    : media === 'image' ? 'images'
    : 'hot';
  // crumb only when filtering down to media — landing scope is implied by the
  // tab highlight and doesn't need a redundant breadcrumb echo.
  const crumb = media ? scopeLabel : undefined;

  // Sub-tab href builder — preserves the current media scope so 最新/最热
  // toggle stays inside 视频 or 图片. Drops `page=` and `sort=` to start
  // fresh; advanced filter chips (tag/date/length) survive because they
  // are conceptually orthogonal to the primary sort.
  const subTabHref = (next: 'hot' | 'latest') => {
    const p = new URLSearchParams();
    if (media) p.set('media', media);
    if (next === 'latest') p.set('sort', 'latest');  // hot is the implicit default
    if (searchParams.tag) p.set('tag', searchParams.tag);
    if (searchParams.length) p.set('length', searchParams.length);
    if (searchParams.date && searchParams.date !== 'all') p.set('date', searchParams.date);
    const qs = p.toString();
    return qs ? `/?${qs}` : '/';
  };

  // Surface rule: 所有列表页(热门精选/视频/图片/任意 filter 组合)都使用
  // 完整 FilterBar,UI 跟 /search 一致。SortTab 不再出现,排序统一收进
  // FilterBar 的"排序"行。
  const showFilterBar = true;
  const showSortTabs = false;

  return (
    <div style={{ minHeight: '100vh', background: X.page, color: X.text }}>
      <SiteHeader crumb={crumb} activeTab={activeTab} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        {/* SEO-only h1 — visible heading lives in the meta row below */}
        <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
          {scopeLabel} · {SITE_NAME}
        </h1>

        {/* ── Category pills: 自拍 / 偷拍 / 调教 / 探花 / 其他 ── */}
        <CategoryNav mediaScope={media} active={searchParams.category} />

        {/* ── Sort sub-tabs only when FilterBar is hidden (landing scope) ── */}
        {showSortTabs && (
          <div style={{
            display: 'flex', alignItems: 'center',
            borderBottom: `1px solid ${X.border}`,
            marginBottom: 20,
          }}>
            <SortTab href={subTabHref('hot')} active={sort === 'hot'}>最热</SortTab>
            <SortTab href={subTabHref('latest')} active={sort === 'latest'}>最新</SortTab>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: X.textMuted, paddingBottom: 12 }}>
              <span>共 {total} 条</span>
            </div>
          </div>
        )}

        {showFilterBar && (
          <>
            <FilterBar basePath="/" current={{ ...searchParams, sort }} defaultSort="hot" />
            <div style={{ fontSize: 12, color: X.textMuted, marginBottom: 12 }}>共 {total} 条</div>
          </>
        )}

        {items.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', background: X.surface, border: `1px dashed ${X.borderStrong}`, borderRadius: 12, color: X.textSecondary }}>
            {showFilterBar ? (
              <>没有匹配的文章 · 试试调整筛选条件,或<Link href="/" style={{ color: X.accent }}> 返回首页</Link></>
            ) : (
              <>暂无已发布的{scopeLabel}</>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {items.map((a) => <ArticleCard key={a.id} a={a} />)}
          </div>
        )}

        <Pagination basePath="/" searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </main>
      <SiteFooter />
    </div>
  );
}

// Underline tab matching the SiteHeader nav — same accent + same 4px rule —
// so the sort row reads as a continuation of the primary tab strip.
function SortTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '12px 16px',
      fontSize: 14,
      fontWeight: active ? 700 : 600,
      color: active ? X.text : X.textSecondary,
      borderBottom: `2px solid ${active ? X.accent : 'transparent'}`,
      marginBottom: -1,
      textDecoration: 'none',
    }}>{children}</Link>
  );
}

