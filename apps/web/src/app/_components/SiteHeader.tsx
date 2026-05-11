import Link from 'next/link';
import type { ReactNode } from 'react';

// 'tags' is still a valid value to keep existing `activeTab="tags"` call
// sites from breaking — it just no longer renders a separate tab.
// Tag navigation now lives inside the 站内搜索 page as a tag-pill section.
export type TabKey = 'hot' | 'videos' | 'images' | 'latest' | 'topics' | 'tags' | 'search';

const TABS: Array<{ key: TabKey; label: string; href: string }> = [
  { key: 'hot',     label: '热门精选', href: '/?sort=hot' },
  { key: 'videos',  label: '视频',     href: '/?media=video' },
  { key: 'images',  label: '图片',     href: '/?media=image' },
  { key: 'latest',  label: '最新更新', href: '/#latest' },
  { key: 'topics',  label: '主题专区', href: '/topic/weekly-hot' },
  { key: 'search',  label: '站内搜索', href: '/search' },
];

export function SiteHeader({ crumb, activeTab }: { crumb?: ReactNode; activeTab?: TabKey }) {
  return (
    <header style={{
      background: '#020617',
      borderBottom: '1px solid #1e293b',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* ── Row 1 — chrome (home, breadcrumb, search, admin) ── */}
      <div style={{
        padding: '0 24px',
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        {/* Brand wordmark hidden per request — keep an unlabelled home anchor
            so screen readers and crawlers still reach `/`, and the breadcrumb
            slot below still has a leading link to render against. */}
        <Link href="/" aria-label="首页" style={{
          color: '#94a3b8', textDecoration: 'none', fontSize: 18, lineHeight: 1, padding: '0 2px',
        }}>⌂</Link>
        {crumb && (
          <>
            <span style={{ color: '#334155' }}>/</span>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>{crumb}</span>
          </>
        )}
        <form action="/search" method="get" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <input
            type="search"
            name="q"
            placeholder="搜索文章 / 标签"
            aria-label="站内搜索"
            style={{
              width: 220,
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '5px 10px',
              color: '#e2e8f0',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </form>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={chromeLinkStyle}>工作台 →</Link>
          <Link href="/admin" style={{ ...chromeLinkStyle, color: '#a5b4fc' }} title="按 Day 分页的验收后台">Admin →</Link>
        </div>
      </div>

      {/* ── Row 2 — primary nav tabs ── */}
      <nav aria-label="主导航" style={{
        padding: '0 24px',
        height: 40,
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
      }}>
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <Link key={t.key} href={t.href} style={{
              padding: '0 16px',
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              color: active ? '#e2e8f0' : '#64748b',
              borderBottom: `2px solid ${active ? '#6366f1' : 'transparent'}`,
              textDecoration: 'none',
              letterSpacing: 0.2,
            }}>{t.label}</Link>
          );
        })}
      </nav>
    </header>
  );
}

// Match the workbench top-right buttons exactly so 工作台/Admin look the same
// no matter where you enter the system from.
const chromeLinkStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  textDecoration: 'none',
  padding: '4px 10px',
  border: '1px solid #334155',
  borderRadius: 6,
};
