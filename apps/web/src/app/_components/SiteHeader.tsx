import Link from 'next/link';
import type { ReactNode } from 'react';
import { X } from './theme';

// Trimmed nav: only 4 tabs surfaced (热门精选 / 视频 / 图片 / 站内搜索).
// 'latest', 'topics', 'tags' remain valid TabKey values so existing
// `activeTab=` call sites compile — they just won't highlight any tab.
// Their underlying routes (/topic/*, /tag/*) still work via direct URL.
export type TabKey = 'hot' | 'videos' | 'images' | 'latest' | 'topics' | 'tags' | 'search';

// "热门精选" 落到根 `/`(LandingView 默认按 sort=hot 渲染),避免和 `/?sort=hot`
// 两条不同视图路径并存导致同一 tab 出现两种 UI。视频/图片 tab 走 ?media=*
// 走 FilteredView,并在那里出现 最新/最热 子 tab 切换该媒体类型的排序。
const TABS: Array<{ key: TabKey; label: string; href: string }> = [
  { key: 'hot',     label: '热门精选', href: '/' },
  { key: 'videos',  label: '视频',     href: '/?media=video' },
  { key: 'images',  label: '图片',     href: '/?media=image' },
  { key: 'search',  label: '站内搜索', href: '/search' },
];

export function SiteHeader({ crumb, activeTab }: { crumb?: ReactNode; activeTab?: TabKey }) {
  return (
    <header style={{
      background: 'rgba(0, 0, 0, 0.85)',         // sticky 头：纯黑半透明 + 背景模糊,和页面 #000 一致
      backdropFilter: 'saturate(180%) blur(12px)',
      WebkitBackdropFilter: 'saturate(180%) blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* ── Row 1 — chrome (home, breadcrumb, search, admin) ── */}
      {/* maxWidth 1200 + 20px 横向 padding = 与 <main> 完全对齐 */}
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '0 20px',
        height: 53,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        {/* Brand mark — 堆叠卡片 logo. Three layered rounded squares that step
            up and to the right with increasing alpha (35 → 65 → 100). Suggests
            "stacked content cards" — matches the B1 card-grid landing aesthetic.
            32×32 viewBox sized to 28px to sit cleanly in the 53px chrome row. */}
        <Link href="/" aria-label="内容中台 首页" style={{
          display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
          padding: '0 2px',
        }}>
          <SiteLogo />
        </Link>
        {crumb && (
          <>
            <span style={{ color: X.borderStrong }}>/</span>
            <span style={{ fontSize: 14, color: X.textSecondary, fontWeight: 500 }}>{crumb}</span>
          </>
        )}
        {/* Top-right inline search hidden — full search is available via the
         *  "站内搜索" tab in the nav row below, so the chrome row stays clean. */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={chromeLinkStyle}>工作台 →</Link>
          <Link href="/admin" style={{ ...chromeLinkStyle, color: X.accent, borderColor: X.accent }} title="按 Day 分页的验收后台">Admin →</Link>
        </div>
      </div>

      {/* ── Row 2 — primary nav tabs ── */}
      {/* Tab 左边 padding 用 4px (而非 20px), 因为每个 tab Link 自带 16px 左
       *  padding —— 4 + 16 = 20 与 main 完全对齐, "热门精选" 文字左边缘正好
       *  落在 main 内容(如 "全部" 胶囊)的左边缘。
       *  borderBottom 落在这一行(而非外层 header), 这样灰线只覆盖 1200px
       *  居中区域,左右两端不再通栏延伸,跟内容宽度对齐。 */}
      <nav aria-label="主导航" style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '0 4px',
        height: 44,
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderBottom: `1px solid ${X.border}`,
      }}>
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <Link key={t.key} href={t.href} style={{
              padding: '0 16px',
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 14,
              fontWeight: active ? 700 : 500,
              color: active ? X.text : X.textSecondary,
              borderBottom: `4px solid ${active ? X.accent : 'transparent'}`,
              textDecoration: 'none',
              letterSpacing: 0.1,
              transition: 'background 0.15s',
            }}>{t.label}</Link>
          );
        })}
      </nav>
    </header>
  );
}

/** Brand mark — three layered rounded squares stepping up-right with
 *  ascending alpha. Standalone so it can be re-used in /admin, favicon
 *  generators, OG image renderers, etc. */
export function SiteLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#1d9bf0" />
      <text x="16" y="23" textAnchor="middle"
            fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
            fontSize="22" fontWeight="900" fill="#ffffff">S</text>
    </svg>
  );
}

const chromeLinkStyle: React.CSSProperties = {
  fontSize: 13,
  color: X.text,
  textDecoration: 'none',
  padding: '6px 14px',
  border: `1px solid ${X.borderStrong}`,
  borderRadius: 9999,
  fontWeight: 600,
};
