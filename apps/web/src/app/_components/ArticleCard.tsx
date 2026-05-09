import Link from 'next/link';
import type { ArticleCardRow } from '../../lib/feed';
import { readMinutes } from '../../lib/feed';
import { proxiedImage } from '../../lib/media';

export function ArticleCard({ a, layout = 'card' }: { a: ArticleCardRow; layout?: 'card' | 'row' }) {
  // Prefer the cover agent's MinIO mirror; fall back to the first raw media
  // URL when the cover agent hasn't run yet so cards still get a thumbnail
  // instead of an empty grey block. Both paths get rewritten to /api/m/* or
  // /api/img-proxy so localhost:9000 never leaks to the browser and X CDN
  // hot-link protection is bypassed via platform-aware Referer.
  const rawCover = a.cover_sizes?.card ?? a.cover_url ?? a.cover_fallback ?? null;
  const thumb = proxiedImage(rawCover, a.source_id);
  const minutes = readMinutes(a.content_length);
  const date = a.published_at ? new Date(a.published_at).toLocaleDateString('zh-CN') : null;

  if (layout === 'row') {
    return (
      <Link href={`/a/${a.slug}`} style={{
        display: 'flex',
        gap: 16,
        padding: 12,
        borderRadius: 8,
        border: '1px solid #334155',
        background: '#1e293b',
        color: '#e2e8f0',
        textDecoration: 'none',
      }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={a.title} loading="lazy" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 4, background: '#0f172a', flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: '#e2e8f0', lineHeight: 1.45 }}>{a.title}</h3>
          {a.summary && (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {a.summary}
            </p>
          )}
          <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {a.category && <span style={{ color: '#a5b4fc' }}>{a.category}</span>}
            {date && <span>{date}</span>}
            <span>{minutes} 分钟阅读</span>
            {a.source && <span>· {a.source}</span>}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/a/${a.slug}`} style={{
      display: 'block',
      color: '#e2e8f0',
      textDecoration: 'none',
      border: '1px solid #334155',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#1e293b',
    }}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt={a.title} loading="lazy" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', background: '#0f172a', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '3/2', background: '#0f172a' }} />
      )}
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 11, color: '#64748b' }}>
          {a.category && <span style={{ color: '#a5b4fc' }}>{a.category}</span>}
          <span>· {minutes} 分钟</span>
        </div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.4, color: '#e2e8f0' }}>{a.title}</h2>
        {a.summary && (
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {a.summary}
          </p>
        )}
      </div>
    </Link>
  );
}
