import Link from 'next/link';
import { getTopTags } from '../../lib/feed';

export async function TagCloud({ active, limit = 30, variant = 'cards' }: { active?: string; limit?: number; variant?: 'pills' | 'cards' }) {
  const tags = await getTopTags(limit);
  if (tags.length === 0) return null;

  if (variant === 'pills') {
    return (
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tags.map((t) => {
          const isActive = t.tag === active;
          const fontSize = 12 + Math.min(4, Math.floor(Math.log2(Math.max(2, t.count))));
          return (
            <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} style={{
              padding: '3px 10px',
              border: `1px solid ${isActive ? '#6366f1' : '#334155'}`,
              borderRadius: 12,
              color: isActive ? '#fff' : '#cbd5e1',
              background: isActive ? '#6366f1' : '#1e293b',
              textDecoration: 'none',
              fontSize,
              fontWeight: isActive ? 600 : 400,
            }}>
              #{t.tag} <span style={{ color: isActive ? '#e0e7ff' : '#64748b', fontSize: 11 }}>{t.count}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {tags.map((t) => {
        const isActive = t.tag === active;
        return (
          <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} style={{
            display: 'block',
            background: isActive ? '#312e81' : '#1e293b',
            border: `1px solid ${isActive ? '#6366f1' : '#334155'}`,
            borderRadius: 8,
            padding: '12px 14px',
            color: '#e2e8f0',
            textDecoration: 'none',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: isActive ? '#a5b4fc' : '#a5b4fc', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              #{t.tag}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{t.count} 篇文章</div>
          </Link>
        );
      })}
    </div>
  );
}
