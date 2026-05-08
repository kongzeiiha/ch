import Link from 'next/link';
import type { ReactNode } from 'react';

export function SiteHeader({ crumb }: { crumb?: ReactNode }) {
  return (
    <header style={{
      background: '#020617',
      borderBottom: '1px solid #1e293b',
      padding: '0 24px',
      height: 52,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <Link href="/" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: 16, fontWeight: 800 }}>
        内容中台
      </Link>
      {crumb && (
        <>
          <span style={{ color: '#334155' }}>/</span>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>{crumb}</span>
        </>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <Link href="/workbench" style={{
          fontSize: 12, color: '#a5b4fc', textDecoration: 'none',
          padding: '4px 10px', border: '1px solid #334155', borderRadius: 6,
        }}>工作台 →</Link>
        <Link href="/admin" style={{
          fontSize: 12, color: '#94a3b8', textDecoration: 'none',
          padding: '4px 10px', border: '1px solid #334155', borderRadius: 6,
        }}>Admin →</Link>
      </div>
    </header>
  );
}
