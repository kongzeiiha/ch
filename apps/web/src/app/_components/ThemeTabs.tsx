import Link from 'next/link';
import { THEMES } from '../_data/topics';

export function ThemeTabs({ active }: { active?: string }) {
  return (
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
      {THEMES.map((t) => {
        const isActive = t.slug === active;
        return (
          <Link
            key={t.slug}
            href={`/topic/${t.slug}`}
            style={{
              padding: '6px 14px',
              border: `1px solid ${isActive ? '#6366f1' : '#334155'}`,
              borderRadius: 8,
              background: isActive ? '#6366f1' : '#1e293b',
              color: isActive ? '#fff' : '#cbd5e1',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
            }}
          >
            {t.title}
          </Link>
        );
      })}
    </nav>
  );
}
