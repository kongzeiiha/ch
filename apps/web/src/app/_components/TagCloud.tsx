import Link from 'next/link';
import { getTopTags } from '../../lib/feed';
import { X } from './theme';

// Hover transitions can't live in inline styles, so we ship a <style> tag once
// per render. Scoped via unique class names so they don't bleed elsewhere.
const TAG_CSS = `
  .tag-card { transition: background 0.15s ease, border-color 0.15s ease; position: relative; overflow: hidden; }
  .tag-card:hover { background: ${X.surfaceSoft}; border-color: ${X.borderStrong}; }
  .tag-card:hover .tag-watermark { color: ${X.accent}22; }
  .tag-pill { transition: background 0.15s ease, border-color 0.15s ease; }
  .tag-pill:hover { background: ${X.surfaceSoft}; }
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
            const fontSize = 13 + Math.min(3, Math.floor(Math.log2(Math.max(2, t.count))));
            return (
              <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} className="tag-pill" style={{
                padding: '5px 14px',
                border: `1px solid ${isActive ? X.accent : X.borderStrong}`,
                borderRadius: 9999,
                color: isActive ? '#ffffff' : X.text,
                background: isActive ? X.accent : X.surface,
                textDecoration: 'none',
                fontSize,
                fontWeight: isActive ? 700 : 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ color: isActive ? '#ffffff' : X.accent, fontWeight: 800 }}>#</span>
                {t.tag}
                <span style={{
                  fontSize: 11, padding: '1px 6px', borderRadius: 8,
                  background: isActive ? 'rgba(255,255,255,0.18)' : X.surfaceSoft,
                  color: isActive ? '#ffffff99' : X.textSecondary,
                  fontVariantNumeric: 'tabular-nums',
                }}>{t.count}</span>
              </Link>
            );
          })}
        </nav>
      </>
    );
  }

  // 卡片视图。X 风格放弃花哨渐变,改用极简浅色卡片 + 大水印 #。
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TAG_CSS }} />
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {tags.map((t) => {
          const isActive = t.tag === active;
          return (
            <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} className="tag-card" style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 80,
              background: isActive ? X.accentBg : X.surface,
              border: `1px solid ${isActive ? X.accent : X.border}`,
              borderRadius: 16,
              padding: '14px 16px',
              color: X.text,
              textDecoration: 'none',
            }}>
              <span className="tag-watermark" aria-hidden style={{
                position: 'absolute',
                top: -18,
                right: -10,
                fontSize: 78,
                fontWeight: 900,
                lineHeight: 1,
                color: isActive ? `${X.accent}33` : `${X.border}`,
                pointerEvents: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}>#</span>
              <div className="tag-name" style={{
                fontSize: 15, fontWeight: 700, color: isActive ? X.accent : X.text,
                marginBottom: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                {t.tag}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, position: 'relative' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: X.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{t.count}</span>
                <span style={{ fontSize: 12, color: X.textSecondary }}>篇文章</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
