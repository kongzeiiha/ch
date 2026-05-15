import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { query, SITE_URL, SITE_NAME } from '../../../lib/db';
import { getFiltered, type LengthBucket, type DateBucket } from '../../../lib/feed';
import { breadcrumbJsonLd, collectionPageJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { JsonLd } from '../../_components/JsonLd';
import { CategoryNav } from '../../_components/CategoryNav';
import { FilterBar } from '../../_components/FilterBar';
import { Pagination } from '../../_components/Pagination';
import { XLayout } from '../../_components/XLayout';
import { XFeedHeader } from '../../_components/XFeedHeader';
import { XPost } from '../../_components/XPost';
import { isJunkTag } from '../../../lib/strip-urls';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tag?: string;
  length?: LengthBucket;
  date?: DateBucket;
  sort?: 'latest' | 'hot';
  page?: string;
  [key: string]: string | undefined;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const category = decodeURIComponent(params.slug);
  const canonical = `${SITE_URL}/category/${params.slug}`;
  // ~140 chars — fills the SERP snippet without truncation. Layout's title
  // template appends " | 内容中台" so we keep title bare here.
  const description = `${category}专题 - 精选「${category}」分类下的最新内容,涵盖热门精选、深度长文、最新发布,为你聚合全网相关话题。`;
  return {
    title: category,
    description,
    alternates: { canonical },
    robots: ROBOTS_INDEXABLE,
    openGraph: {
      title: `${category} - ${SITE_NAME}`,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'zh_CN',
      images: ogImages(),
    },
  };
}

const PAGE_SIZE = 20;

export default async function CategoryPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const category = decodeURIComponent(params.slug);
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const [{ items, total }, tags] = await Promise.all([
    getFiltered({
      category,
      tag: searchParams.tag,
      length: searchParams.length,
      date: searchParams.date,
      sort: searchParams.sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    loadTagsInCategory(category),
  ]);

  // Hard-404 when an unknown category has zero matching articles AND no
  // filter is active. Returning a 200 with an empty grid is a soft-404 from
  // Google's perspective and dilutes site quality signals. With filters
  // applied we keep the 200 so users can tweak filters back to find content.
  const hasFilter = !!(searchParams.tag || searchParams.length || searchParams.date || searchParams.sort);
  if (total === 0 && !hasFilter) notFound();

  const basePath = `/category/${params.slug}`;

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    { name: category, url: `${SITE_URL}/category/${params.slug}` },
  ];

  return (
    <XLayout active="home">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={collectionPageJsonLd({
        name: `${category} - ${SITE_NAME}`,
        description: `${category} 分类下的最新文章`,
        url: `${SITE_URL}${basePath}`,
        items: items.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug })),
      })} />
      <XFeedHeader title={category} back fallbackHref="/" />

      <div style={{ padding: '12px 16px 0' }}>
        <CategoryNav active={category} />
        <p style={{ fontSize: 14, color: '#536471', margin: '0 0 12px' }}>共 {total} 篇文章</p>
        <FilterBar basePath={basePath} current={searchParams} tags={tags} />
      </div>

      {items.length === 0 ? (
        <p style={{ color: '#536471', padding: 40, textAlign: 'center' }}>
          没有匹配的文章 · 试试调整筛选条件
        </p>
      ) : (
        items.map((a) => <XPost key={a.id} a={a} />)
      )}

      <div style={{ padding: '16px 16px 40px' }}>
        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </div>
    </XLayout>
  );
}

async function loadTagsInCategory(category: string): Promise<{ tag: string; count: number }[]> {
  // Pull more rows than we render — the post-filter trims out LLM-artifact
  // tags ("关键词《X》") and sentence-length junk, so the visible Top 30 ends
  // up actually being 30 clean entries instead of "8 clean + 22 noise".
  const rows = await query<{ tag: string; count: number }>(
    `SELECT jt.tag AS tag, COUNT(*) AS count
     FROM items i,
          JSON_TABLE(i.tags, '$[*]' COLUMNS (tag VARCHAR(128) CHARACTER SET utf8mb4 PATH '$')) jt
     WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND i.category = $1 AND jt.tag IS NOT NULL
     GROUP BY jt.tag
     ORDER BY count DESC
     LIMIT 90`,
    [category],
  );
  return rows
    .filter((r) => !isJunkTag(r.tag))
    .slice(0, 30)
    .map((r) => ({ tag: r.tag, count: Number(r.count) }));
}
