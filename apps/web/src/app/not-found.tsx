import Link from 'next/link';
import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../lib/db';
import { X } from './_components/theme';

// 故意不复用 XLayout — XRightRail 在 build 阶段会查 DB(getTopTags / getTopSources),
// Next 把 not-found 当 static prerender, build 时拿不到 MySQL/Redis 直接报 ECONNREFUSED。
// 这里渲染一个无 DB 依赖的简版 404,build 不挂。

export const metadata: Metadata = {
  title: '页面未找到',
  description: `你访问的页面不存在或已被删除。返回${SITE_NAME}首页继续浏览。`,
  robots: { index: false, follow: true },
  alternates: { canonical: `${SITE_URL}/404` },
};

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      background: X.page,
      color: X.text,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      fontFamily: '"Chirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: 96, fontWeight: 900, color: X.accent, marginBottom: 8, lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 12px', color: X.text }}>页面未找到</h1>
        <p style={{ color: X.textSecondary, marginBottom: 28, lineHeight: 1.7 }}>
          你访问的链接可能已过期、被删除,或地址输入有误。<br />
          可以从下面的入口继续浏览。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <PillLink href="/">返回首页</PillLink>
          <PillLink href="/?sort=hot">热门精选</PillLink>
          <PillLink href="/tag">标签导航</PillLink>
          <PillLink href="/search">站内搜索</PillLink>
        </div>
      </div>
    </div>
  );
}

function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '10px 20px',
      background: X.surface,
      border: `1px solid ${X.borderStrong}`,
      borderRadius: 9999,
      color: X.text,
      textDecoration: 'none',
      fontSize: 14,
      fontWeight: 600,
    }}>{children}</Link>
  );
}
