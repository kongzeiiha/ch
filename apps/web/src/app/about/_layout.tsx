import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '../_components/SiteHeader';
import { SiteFooter } from '../_components/SiteFooter';
import { X } from '../_components/theme';

const PAGES = [
  { slug: 'terms',   title: '服务条款' },
  { slug: 'privacy', title: '隐私政策' },
  { slug: 'dmca',    title: '版权投诉(DMCA)' },
];

export function AboutShell({ active, title, updated, children }: {
  active: 'terms' | 'privacy' | 'dmca';
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', background: X.page, color: X.text }}>
      <SiteHeader crumb={title} />

      <main style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '32px 20px 60px',
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 32,
      }}>
        <aside>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 72 }}>
            {PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={`/about/${p.slug}`} style={{
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: p.slug === active ? X.surface : 'transparent',
                  color: p.slug === active ? X.accent : X.textSecondary,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: p.slug === active ? 700 : 500,
                  borderLeft: p.slug === active ? `3px solid ${X.accent}` : '3px solid transparent',
                }}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </aside>

        <article style={{ lineHeight: 1.85, color: X.textSecondary, fontSize: 15 }}>
          <header style={{ marginBottom: 28, paddingBottom: 14, borderBottom: `1px solid ${X.border}` }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 6px', color: X.text }}>{title}</h1>
            <div style={{ fontSize: 12, color: X.textMuted }}>最近更新:{updated}</div>
          </header>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
