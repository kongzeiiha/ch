import Link from 'next/link';
import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../lib/db';
import { SiteHeader } from './_components/SiteHeader';
import { SiteFooter } from './_components/SiteFooter';

// Custom 404 — Next.js 14+ uses this for any unhandled or notFound() route.
// Returning a server-rendered page with internal links lets us recover lost
// crawler traffic onto live pages, and avoids Google flagging the route as a
// soft 404. The HTTP status is set to 404 by Next automatically.
export const metadata: Metadata = {
  title: '页面未找到',
  description: `你访问的页面不存在或已被删除。返回${SITE_NAME}首页继续浏览。`,
  robots: { index: false, follow: true },
  alternates: { canonical: `${SITE_URL}/404` },
};

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />
      <main style={{ flex: 1, maxWidth: 720, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, fontWeight: 700, color: '#334155', marginBottom: 8 }}>404</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: '#e2e8f0' }}>页面未找到</h1>
        <p style={{ color: '#94a3b8', marginBottom: 28, lineHeight: 1.7 }}>
          你访问的链接可能已过期、被删除,或地址输入有误。<br />
          可以从下面的入口继续浏览。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <PillLink href="/">返回首页</PillLink>
          <PillLink href="/?sort=hot">热门精选</PillLink>
          <PillLink href="/tag">标签导航</PillLink>
          <PillLink href="/search">站内搜索</PillLink>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '10px 20px',
      background: '#1e293b',
      border: '1px solid #334155',
      borderRadius: 6,
      color: '#cbd5e1',
      textDecoration: 'none',
      fontSize: 14,
    }}>{children}</Link>
  );
}
