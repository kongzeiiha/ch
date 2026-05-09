import Link from 'next/link';
import { query } from '../../lib/db';

interface CatRow {
  category: string;
  count: number;
}

export async function CategoryNav({ active }: { active?: string }) {
  const categories = await query<CatRow>(
    `SELECT category, COUNT(*)::int AS count FROM items
     WHERE status IN ('PUBLISHED','DISTRIBUTED') AND category IS NOT NULL
     GROUP BY category ORDER BY count DESC`,
  );

  if (categories.length === 0) return null;

  return (
    <nav style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Link href="/" style={pillStyle(!active)}>
        全部 <span style={{ color: !active ? '#e0e7ff' : '#64748b' }}>· {categories.reduce((n, c) => n + c.count, 0)}</span>
      </Link>
      {categories.map((c) => {
        const isActive = c.category === active;
        return (
          <Link key={c.category} href={`/category/${encodeURIComponent(c.category)}`} style={pillStyle(isActive)}>
            {c.category} <span style={{ color: isActive ? '#e0e7ff' : '#64748b' }}>· {c.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    border: `1px solid ${active ? '#6366f1' : '#334155'}`,
    borderRadius: 16,
    color: active ? '#fff' : '#cbd5e1',
    textDecoration: 'none',
    fontSize: 13,
    background: active ? '#6366f1' : '#1e293b',
    fontWeight: active ? 600 : 400,
  };
}
