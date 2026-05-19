import Link from 'next/link';
import type { ReactNode } from 'react';
import { XLayout } from '../_components/XLayout';
import { XFeedHeader } from '../_components/XFeedHeader';
import { X } from '../_components/theme';

const PAGES = [
  { slug: 'terms',   title: '服务条款' },
  { slug: 'privacy', title: '隐私政策' },
  { slug: 'dmca',    title: '版权投诉(DMCA)' },
];

// /about/* 公开页面用 X 三栏布局包,跟站点其它页一致 — 左栏 nav、右栏推荐栏
// 都保留,中间是内容。原 SiteHeader + 2-列布局视觉割裂,从左导航点 "关于"
// 进来会感觉跑去了另一个站。
export function AboutShell({ active, title, updated, children }: {
  active: 'terms' | 'privacy' | 'dmca';
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <XLayout>
      <XFeedHeader title={title} back fallbackHref="/" />
      <div style={{ padding: '16px 20px 40px' }}>
        {/* 子页切换:terms / privacy / dmca 横排胶囊 */}
        <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {PAGES.map((p) => (
            <Link key={p.slug} href={`/about/${p.slug}`} style={{
              padding: '6px 14px',
              borderRadius: 9999,
              border: `1px solid ${p.slug === active ? X.accent : X.borderStrong}`,
              background: p.slug === active ? X.accent : 'transparent',
              color: p.slug === active ? '#ffffff' : X.text,
              fontSize: 13,
              fontWeight: p.slug === active ? 700 : 500,
              textDecoration: 'none',
            }}>{p.title}</Link>
          ))}
        </nav>

        <article style={{ lineHeight: 1.85, color: X.text, fontSize: 15 }}>
          <header style={{ marginBottom: 24, paddingBottom: 12, borderBottom: `1px solid ${X.border}` }}>
            <div style={{ fontSize: 12, color: X.textMuted }}>最近更新:{updated}</div>
          </header>
          {children}
        </article>
      </div>
    </XLayout>
  );
}
