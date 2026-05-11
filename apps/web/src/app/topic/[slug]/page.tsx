import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFiltered, type LengthBucket, type DateBucket } from '../../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { breadcrumbJsonLd, collectionPageJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { resolveTopic, type TopicKind } from '../../_data/topics';
import { SiteHeader } from '../../_components/SiteHeader';
import { JsonLd } from '../../_components/JsonLd';
import { ArticleCard } from '../../_components/ArticleCard';
import { FilterBar } from '../../_components/FilterBar';
import { Pagination } from '../../_components/Pagination';
import { SiteFooter } from '../../_components/SiteFooter';
import { ThemeTabs } from '../../_components/ThemeTabs';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const topic = await resolveTopic(params.slug);
  if (!topic) return { title: '未找到', robots: { index: false, follow: false } };
  const canonical = `${SITE_URL}/topic/${params.slug}`;
  const titleBare = topic.kind === 'keyword' ? `#${topic.title}` : topic.title;
  // Spell out the topic kind in the description so it gives crawlers more
  // surface than the bare title — ~120 chars, well under the 160 cap.
  const description = `${KIND_LABEL_FOR_DESC[topic.kind]}「${titleBare}」专题 · ${topic.description}`;
  return {
    title: titleBare,
    description,
    alternates: { canonical },
    robots: ROBOTS_INDEXABLE,
    openGraph: {
      title: `${titleBare} - ${SITE_NAME}`,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'zh_CN',
      images: ogImages(),
    },
  };
}

const KIND_LABEL_FOR_DESC: Record<TopicKind, string> = {
  theme:   '专题',
  source:  '来源账号',
  keyword: '趋势关键词',
};

const PAGE_SIZE = 24;

const KIND_LABEL: Record<TopicKind, string> = {
  theme:   '专题',
  source:  '来源账号',
  keyword: '趋势关键词',
};

export default async function TopicPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ tag?: string; keyword?: string; length?: LengthBucket; date?: DateBucket; sort?: 'latest' | 'hot'; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const topic = await resolveTopic(params.slug);
  if (!topic) notFound();

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  // Topic filter is the baseline; URL filters layer on top so users can
  // narrow the topic feed without breaking the topic identity.
  const merged = {
    ...topic.filter,
    tag:    searchParams.tag    ?? topic.filter.tag,
    // For keyword topics, don't let URL ?keyword= override the topic's own
    // keyword (the topic identity IS the keyword). For other kinds, allow.
    keyword: topic.kind === 'keyword' ? topic.filter.keyword : (searchParams.keyword ?? topic.filter.keyword),
    length: searchParams.length ?? topic.filter.length,
    date:   searchParams.date   ?? topic.filter.date,
    sort:   searchParams.sort   ?? topic.filter.sort,
    limit:  PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { items, total } = await getFiltered(merged);
  const basePath = `/topic/${params.slug}`;

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    { name: topic.kind === 'keyword' ? `#${topic.title}` : topic.title, url: `${SITE_URL}/topic/${params.slug}` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={topic.title} activeTab="topics" />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={collectionPageJsonLd({
        name: `${topic.kind === 'keyword' ? `#${topic.title}` : topic.title} - ${SITE_NAME}`,
        description: topic.description,
        url: `${SITE_URL}${basePath}`,
        items: items.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug })),
      })} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        {topic.kind === 'theme' && <ThemeTabs active={topic.slug} />}

        {/* Kicker (KIND_LABEL) removed — the breadcrumb + ThemeTabs above
            already place the user. H1 + description line carry the rest. */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px', color: '#e2e8f0' }}>
            {topic.kind === 'keyword' ? `#${topic.title}` : topic.title}
          </h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>{topic.description} · 共 {total} 篇</p>
        </div>

        <FilterBar basePath={basePath} current={searchParams} />

        {items.length === 0 ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center', background: '#1e293b', borderRadius: 8 }}>
            暂无文章
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {items.map((a) => <ArticleCard key={a.id} a={a} />)}
          </div>
        )}

        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </main>
      <SiteFooter />
    </div>
  );
}
