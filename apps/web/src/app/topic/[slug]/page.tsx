import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFiltered, type LengthBucket, type DateBucket } from '../../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { breadcrumbJsonLd, collectionPageJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { resolveTopic, type TopicKind } from '../../_data/topics';
import { JsonLd } from '../../_components/JsonLd';
import { FilterBar } from '../../_components/FilterBar';
import { Pagination } from '../../_components/Pagination';
import { ThemeTabs } from '../../_components/ThemeTabs';
import { XLayout } from '../../_components/XLayout';
import { XFeedHeader } from '../../_components/XFeedHeader';
import { XPost } from '../../_components/XPost';

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

  // Soft-404 guard for unknown keyword topics. The keyword scheme is
  // open-ended (any `/topic/keyword-<anything>` resolves to a TopicDef),
  // so without this an attacker-fed URL would 200 with 0 articles and
  // pollute Google's index with low-quality long-tail. Themes/source
  // topics aren't affected — their resolveTopic() already 404s on miss.
  // We only 404 when there's no URL-level filter; a filter active means
  // the user narrowed it themselves and might want to widen back.
  const hasFilter = !!(searchParams.tag || searchParams.length || searchParams.date || searchParams.sort);
  if (topic.kind === 'keyword' && total === 0 && !hasFilter) notFound();

  const basePath = `/topic/${params.slug}`;

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    { name: topic.kind === 'keyword' ? `#${topic.title}` : topic.title, url: `${SITE_URL}/topic/${params.slug}` },
  ];

  return (
    <XLayout active="topics">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={collectionPageJsonLd({
        name: `${topic.kind === 'keyword' ? `#${topic.title}` : topic.title} - ${SITE_NAME}`,
        description: topic.description,
        url: `${SITE_URL}${basePath}`,
        items: items.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug })),
      })} />
      <XFeedHeader title={topic.kind === 'keyword' ? `#${topic.title}` : topic.title} back fallbackHref="/" />

      <div style={{ padding: '12px 16px 0' }}>
        {topic.kind === 'theme' && <ThemeTabs active={topic.slug} />}
        <p style={{ color: '#536471', margin: '0 0 12px', fontSize: 14 }}>{topic.description} · 共 {total} 篇</p>
        <FilterBar basePath={basePath} current={searchParams} />
      </div>

      {items.length === 0 ? (
        <p style={{ color: '#536471', padding: 40, textAlign: 'center' }}>暂无文章</p>
      ) : (
        items.map((a) => <XPost key={a.id} a={a} />)
      )}

      <div style={{ padding: '16px 16px 40px' }}>
        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </div>
    </XLayout>
  );
}
