import Link from 'next/link';
import type { Metadata } from 'next';
import { getFiltered, type LengthBucket, type DateBucket } from '../lib/feed';
import { SITE_NAME, SITE_URL } from '../lib/db';
import { ROBOTS_INDEXABLE, ogImages } from '../lib/seo';
import { XLayout } from './_components/XLayout';
import { XFeedHeader } from './_components/XFeedHeader';
import { XPost } from './_components/XPost';
import { Pagination } from './_components/Pagination';
import { X } from './_components/theme';

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
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_DESC },
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

const PAGE_SIZE = 20;

export default async function Home(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  // 首页默认按"最新"展示,/?sort=hot 才走热度公式 — 否则左侧导航的「首页」
  // 和「热门」会渲染出完全相同的列表(都是 sort=hot),用户看不出差别。
  const sort: 'latest' | 'hot' = searchParams.sort === 'hot' ? 'hot' : 'latest';
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

  const title = media === 'video' ? '视频'
    : media === 'image' ? '图片'
    : sort === 'hot' ? '热门'
    : '首页';
  const activeNav = media === 'video' ? 'videos'
    : media === 'image' ? 'images'
    : searchParams.sort === 'hot' ? 'hot'
    : 'home';

  // X.com tab strip:为你推荐(=最热) / 最新 / 关注(占位,无登录)
  // 默认 sort=latest,所以 latest tab href 不带参数,hot tab 显式带 ?sort=hot
  const subTabHref = (next: 'hot' | 'latest') => {
    const p = new URLSearchParams();
    if (media) p.set('media', media);
    if (next === 'hot') p.set('sort', 'hot');
    return p.toString() ? `/?${p.toString()}` : '/';
  };

  return (
    <XLayout active={activeNav}>
      <XFeedHeader
        title={title}
        tabs={[
          { key: 'hot', label: '为你推荐', href: subTabHref('hot'), active: sort === 'hot' },
          { key: 'latest', label: '最新', href: subTabHref('latest'), active: sort === 'latest' },
        ]}
      />

      {items.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: X.textSecondary }}>
          暂无匹配内容 · <Link href="/" style={{ color: X.accent }}>返回首页</Link>
        </div>
      ) : (
        <>
          {items.map((a) => <XPost key={a.id} a={a} />)}
          <div style={{ padding: '16px 16px 40px' }}>
            <Pagination basePath="/" searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
          </div>
        </>
      )}
    </XLayout>
  );
}
