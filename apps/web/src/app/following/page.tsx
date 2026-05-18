import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { XLayout } from '../_components/XLayout';
import { XFeedHeader } from '../_components/XFeedHeader';
import { FollowingFeed } from '../_components/FollowingFeed';

// 「关注」页 — server shell + client feed。
//   - page 本身保持 server component,这样 XLayout 内部可以正常查 DB(getTopTags 等右栏数据)
//   - 实际 feed 列表交给 client 子组件 FollowingFeed 处理(它读 LS 后 POST 拿 items)
// 这是 Next.js App Router 推荐的组合方式:server 父级负责 SSR / SEO,client 孩子负责
// 浏览器侧状态(localStorage / IndexedDB)。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '关注 - ' + SITE_NAME,
  description: '你关注的博主最新文章流',
  alternates: { canonical: `${SITE_URL}/following` },
  robots: { index: false, follow: true },
};

export default function FollowingPage() {
  return (
    <XLayout active="following">
      <XFeedHeader title="关注" />
      <FollowingFeed />
    </XLayout>
  );
}
