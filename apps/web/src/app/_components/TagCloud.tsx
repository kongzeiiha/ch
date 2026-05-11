import Link from 'next/link';
import { getTopTags } from '../../lib/feed';

// Hover transitions can't live in inline styles, so we ship a <style> tag once
// per render. Scoped via a unique class name so it doesn't bleed elsewhere.
const TAG_CSS = `
  .tag-card { transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; position: relative; overflow: hidden; }
  .tag-card:hover { transform: translateY(-2px); border-color: #6366f1; box-shadow: 0 6px 20px -8px rgba(99,102,241,0.45); }
  .tag-card:hover .tag-name { color: #c7d2fe; }
  .tag-card:hover .tag-watermark { color: #6366f140; transform: scale(1.05) rotate(-4deg); }
  .tag-watermark { transition: transform 0.18s ease, color 0.18s ease; }
  .tag-pill { transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
  .tag-pill:hover { transform: translateY(-1px); border-color: #6366f1; background: #1e2a4d; }
`;

export async function TagCloud({ active, limit = 30, variant = 'cards' }: { active?: string; limit?: number; variant?: 'pills' | 'cards' }) {
  const tags = await getTopTags(limit);
  if (tags.length === 0) return null;

  if (variant === 'pills') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: TAG_CSS }} />
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tags.map((t) => {
            const isActive = t.tag === active;
            const fontSize = 12 + Math.min(4, Math.floor(Math.log2(Math.max(2, t.count))));
            return (
              <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} className="tag-pill" style={{
                padding: '4px 12px',
                border: `1px solid ${isActive ? '#6366f1' : '#334155'}`,
                borderRadius: 14,
                color: isActive ? '#fff' : '#cbd5e1',
                background: isActive ? '#6366f1' : '#1e293b',
                textDecoration: 'none',
                fontSize,
                fontWeight: isActive ? 600 : 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ color: isActive ? '#e0e7ff' : '#6366f1', fontWeight: 700 }}>#</span>
                {t.tag}
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: isActive ? 'rgba(255,255,255,0.18)' : '#0f172a',
                  color: isActive ? '#e0e7ff' : '#64748b',
                  fontVariantNumeric: 'tabular-nums',
                }}>{t.count}</span>
              </Link>
            );
          })}
        </nav>
      </>
    );
  }

  // Tier popularity for visual emphasis: hot (≥10) / warm (≥3) / cool.
  // Determines accent color, # watermark intensity, and badge style.
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TAG_CSS }} />
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {tags.map((t) => {
          const isActive = t.tag === active;
          const tier = t.count >= 10 ? 3 : t.count >= 3 ? 2 : 1;
          const accent = isActive ? '#6366f1' : tier === 3 ? '#6366f1' : tier === 2 ? '#475569' : '#334155';
          const tagColor = isActive ? '#c7d2fe' : tier === 3 ? '#a5b4fc' : '#cbd5e1';
          const countColor = tier === 3 ? '#a5b4fc' : '#94a3b8';
          return (
            <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} className="tag-card" style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 80,
              background: isActive
                ? 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)'
                : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: `1px solid ${accent}`,
              borderRadius: 10,
              padding: '14px 16px',
              color: '#e2e8f0',
              textDecoration: 'none',
            }}>
              <span className="tag-watermark" aria-hidden style={{
                position: 'absolute',
                top: -18,
                right: -10,
                fontSize: 78,
                fontWeight: 900,
                lineHeight: 1,
                color: tier === 3 ? '#6366f128' : '#33415528',
                pointerEvents: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}>#</span>
              <div className="tag-name" style={{
                fontSize: 15, fontWeight: 700, color: tagColor,
                marginBottom: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                {t.tag}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, position: 'relative' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: countColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{t.count}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>篇文章</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
