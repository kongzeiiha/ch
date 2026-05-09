import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '../_components/SiteHeader';
import { SiteFooter } from '../_components/SiteFooter';

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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
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
                  borderRadius: 6,
                  background: p.slug === active ? '#1e293b' : 'transparent',
                  color: p.slug === active ? '#a5b4fc' : '#94a3b8',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: p.slug === active ? 600 : 400,
                  borderLeft: p.slug === active ? '3px solid #6366f1' : '3px solid transparent',
                }}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </aside>

        <article style={{ lineHeight: 1.85, color: '#cbd5e1', fontSize: 15 }}>
          <header style={{ marginBottom: 28, paddingBottom: 14, borderBottom: '1px solid #334155' }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px', color: '#e2e8f0' }}>{title}</h1>
            <div style={{ fontSize: 12, color: '#64748b' }}>最近更新:{updated}</div>
          </header>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
