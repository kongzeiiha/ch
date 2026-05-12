import Link from 'next/link';
import { THEMES } from '../_data/topics';
import { X } from './theme';

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
              padding: '7px 16px',
              border: `1px solid ${isActive ? X.accent : X.borderStrong}`,
              borderRadius: 9999,
              background: isActive ? X.accent : X.surface,
              color: isActive ? '#ffffff' : X.text,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: isActive ? 700 : 500,
            }}
          >
            {t.title}
          </Link>
        );
      })}
    </nav>
  );
}
