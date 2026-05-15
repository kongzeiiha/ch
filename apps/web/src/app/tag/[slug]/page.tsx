import type { Metadata } from 'next';
import Link from 'next/link';
import { getFiltered, type LengthBucket, type DateBucket } from '../../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { breadcrumbJsonLd, collectionPageJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { JsonLd } from '../../_components/JsonLd';
import { FilterBar } from '../../_components/FilterBar';
import { Pagination } from '../../_components/Pagination';
import { XLayout } from '../../_components/XLayout';
import { XFeedHeader } from '../../_components/XFeedHeader';
import { XPost } from '../../_components/XPost';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const tag = decodeURIComponent(params.slug);
  const canonical = `${SITE_URL}/tag/${params.slug}`;
  const description = `#${tag} 标签下的全部内容,聚合所有标记「${tag}」的文章,按时长、更新日期、热度筛选浏览。`;
  return {
    title: `#${tag}`,
    description,
    alternates: { canonical },
    robots: ROBOTS_INDEXABLE,
    openGraph: {
      title: `#${tag} - ${SITE_NAME}`,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'zh_CN',
      images: ogImages(),
    },
  };
}

const PAGE_SIZE = 24;

export default async function TagPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ length?: LengthBucket; date?: DateBucket; sort?: 'latest' | 'hot'; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const tag = decodeURIComponent(params.slug);
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const { items, total } = await getFiltered({
    tag,
    length: searchParams.length,
    date: searchParams.date,
    sort: searchParams.sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const basePath = `/tag/${params.slug}`;

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    { name: `#${tag}`, url: `${SITE_URL}/tag/${params.slug}` },
  ];

  return (
    <XLayout active="tags">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={collectionPageJsonLd({
        name: `#${tag} - ${SITE_NAME}`,
        description: `所有标记 #${tag} 的文章`,
        url: `${SITE_URL}${basePath}`,
        items: items.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug })),
      })} />
      <XFeedHeader
        title={`#${tag}`}
        back
        fallbackHref="/tag"
        rightAction={<Link href="/tag" style={{ fontSize: 13, color: '#1d9bf0', textDecoration: 'none' }}>查看全部 →</Link>}
      />

      <div style={{ padding: '12px 16px 8px', color: '#536471', fontSize: 14 }}>共 {total} 篇</div>
      <div style={{ padding: '0 16px 12px' }}>
        <FilterBar basePath={basePath} current={{ ...searchParams, tag: undefined }} />
      </div>

      {items.length === 0 ? (
        <p style={{ color: '#536471', padding: 40, textAlign: 'center' }}>没有匹配的文章</p>
      ) : (
        items.map((a) => <XPost key={a.id} a={a} />)
      )}

      <div style={{ padding: '16px 16px 40px' }}>
        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </div>
    </XLayout>
  );
}
