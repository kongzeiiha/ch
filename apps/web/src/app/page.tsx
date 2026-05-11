import Link from 'next/link';
import type { Metadata } from 'next';
import { getHot, getLatest, getFiltered, type LengthBucket, type DateBucket } from '../lib/feed';
import { SITE_NAME, SITE_URL } from '../lib/db';
import { ROBOTS_INDEXABLE, ogImages } from '../lib/seo';
import { THEMES } from './_data/topics';
import { SiteHeader } from './_components/SiteHeader';
import { CategoryNav } from './_components/CategoryNav';
import { ArticleCard } from './_components/ArticleCard';
import { FilterBar } from './_components/FilterBar';
import { Pagination } from './_components/Pagination';
import { CTAModule } from './_components/CTAModule';
import { SiteFooter } from './_components/SiteFooter';

// 站点列表页全部走 force-dynamic:每次请求直接查 MySQL,publishing
// 把 items.status 翻成 PUBLISHED 那一刻起,刷新页面就能看到。
export const dynamic = 'force-dynamic';

const SITE_DESC = '聚合多源精选内容,涵盖热门精选、最新更新、主题专区、标签导航,长尾关键词全方位覆盖。基于多 Agent 自动化流水线持续更新。';

export const metadata: Metadata = {
  // Home gets the bare brand title — layout's template.suffix doesn't apply
  // to the default title to avoid duplicating the site name in the SERP.
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
  media?: 'video' | 'image';
  length?: LengthBucket;
  date?: DateBucket;
  sort?: 'latest' | 'hot';
  page?: string;
  [key: string]: string | undefined;
}

const PAGE_SIZE = 24;

function hasActiveFilter(p: SearchParams): boolean {
  return !!(p.tag || p.media || p.length || (p.date && p.date !== 'all') || p.sort === 'hot' || p.page);
}

export default async function Home(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const filtered = hasActiveFilter(searchParams);

  if (filtered) {
    return <FilteredView searchParams={searchParams} />;
  }
  return <LandingView />;
}

async function LandingView() {
  const [hot, latest] = await Promise.all([
    getHot({ limit: 6, days: 7 }),
    getLatest({ limit: 12 }),
  ]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader activeTab="latest" />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 60px' }}>
        {/* SEO-only h1 — visible block hidden per request, keep heading for crawlers/AT */}
        <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
          {SITE_NAME}
        </h1>

        <CategoryNav />

        {/* 1. 热门精选 */}
        {hot.length > 0 && (
          <Section id="hot" title="热门精选" hint="近 7 天" more={{ href: '/?sort=hot', label: '查看更多 →' }}>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {hot.map((a) => <ArticleCard key={a.id} a={a} />)}
            </div>
          </Section>
        )}

        {/* 2. 最新更新 */}
        <Section id="latest" title="最新更新" more={{ href: '/?sort=latest', label: '查看更多 →' }}>
          {latest.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: '#1e293b', border: '1px dashed #334155', borderRadius: 8, color: '#94a3b8' }}>
              暂无已发布内容
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {latest.map((a) => <ArticleCard key={a.id} a={a} />)}
            </div>
          )}
        </Section>

        {/* 3. 主题专区 */}
        <Section id="topics" title="主题专区" hint="精选话题">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {THEMES.map((t) => (
              <Link key={t.slug} href={`/topic/${t.slug}`} style={{
                display: 'block',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: 16,
                color: '#e2e8f0',
                textDecoration: 'none',
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#a5b4fc', marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{t.description}</div>
              </Link>
            ))}
          </div>
        </Section>

        <div style={{ marginTop: 32 }}>
          <CTAModule />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

async function FilteredView({ searchParams }: { searchParams: SearchParams }) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const { items, total } = await getFiltered({
    tag: searchParams.tag,
    media: searchParams.media,
    length: searchParams.length,
    date: searchParams.date,
    sort: searchParams.sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // Crumb + active-tab pick the most specific scope. Media beats sort beats
  // generic "latest" so the header highlights the tab the user just clicked.
  const heading = searchParams.media === 'video' ? '视频'
    : searchParams.media === 'image' ? '图片'
    : searchParams.sort === 'hot' ? '热门精选'
    : '全部内容';
  const activeTab = searchParams.media === 'video' ? 'videos'
    : searchParams.media === 'image' ? 'images'
    : searchParams.sort === 'hot' ? 'hot'
    : 'latest';

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={heading} activeTab={activeTab} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 60px' }}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px', color: '#e2e8f0' }}>{heading}</h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>共 {total} 篇 · 已应用筛选</p>
        </header>

        <CategoryNav />

        <FilterBar basePath="/" current={searchParams} />

        {items.length === 0 ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center', background: '#1e293b', borderRadius: 8 }}>
            没有匹配的文章 · 试试调整筛选条件,或<Link href="/" style={{ color: '#a5b4fc' }}> 返回首页</Link>
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {items.map((a) => <ArticleCard key={a.id} a={a} />)}
          </div>
        )}

        <Pagination basePath="/" searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({
  id, title, hint, more, children, minHeight,
}: {
  id?: string;
  title: string;
  hint?: string;
  more?: { href: string; label: string };
  children: React.ReactNode;
  minHeight?: string | number;
}) {
  return (
    <section id={id} style={{ marginTop: 32, scrollMarginTop: 110, minHeight }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 14, gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#e2e8f0' }}>{title}</h2>
        {hint && <span style={{ fontSize: 12, color: '#64748b' }}>{hint}</span>}
        {more && (
          <Link href={more.href} style={{ marginLeft: 'auto', fontSize: 12, color: '#a5b4fc', textDecoration: 'none' }}>
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
