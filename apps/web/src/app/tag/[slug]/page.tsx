import type { Metadata } from 'next';
import Link from 'next/link';
import { getFiltered, type LengthBucket, type DateBucket } from '../../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { breadcrumbJsonLd, collectionPageJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../../lib/seo';
import { SiteHeader } from '../../_components/SiteHeader';
import { JsonLd } from '../../_components/JsonLd';
import { ArticleCard } from '../../_components/ArticleCard';
import { FilterBar } from '../../_components/FilterBar';
import { Pagination } from '../../_components/Pagination';
import { SiteFooter } from '../../_components/SiteFooter';

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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb={`#${tag}`} activeTab="tags" />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={collectionPageJsonLd({
        name: `#${tag} - ${SITE_NAME}`,
        description: `所有标记 #${tag} 的文章`,
        url: `${SITE_URL}${basePath}`,
        items: items.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug })),
      })} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>标签</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px', color: '#e2e8f0' }}>#{tag}</h1>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>共 {total} 篇</p>
            <Link href="/tag" style={{ fontSize: 13, color: '#a5b4fc', textDecoration: 'none' }}>查看全部标签 →</Link>
          </div>
        </div>

        <FilterBar basePath={basePath} current={{ ...searchParams, tag: undefined }} />

        {items.length === 0 ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center', background: '#1e293b', borderRadius: 8 }}>
            没有匹配的文章
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
