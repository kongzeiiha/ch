import Link from 'next/link';
import type { ArticleCardRow } from '../../lib/feed';
import { readMinutes } from '../../lib/feed';
import { proxiedImage } from '../../lib/media';
import { displayTitle } from '../../lib/strip-urls';

// For raw social posts, the title agent often regurgitates the source text
// into both `title` and `summary` (with maybe a `@source` tail), so the card
// shows the same sentence twice. Treat the summary as redundant whenever the
// shorter string is fully contained in the longer one after whitespace + URL
// normalization — covers exact dupes and "title + extra suffix" patterns.
function summaryIsDuplicate(title: string, summary: string | null | undefined): boolean {
  if (!summary) return true;
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/@\w+/g, '').toLowerCase();
  const t = norm(title);
  const s = norm(summary);
  if (!s || !t) return true;
  return t === s || t.includes(s) || s.includes(t);
}

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
  // Many feeds embed `https://t.co/xxx` inside the title/summary — strip for
  // a cleaner card. displayTitle does the full display-grade cleanup: URL +
  // @mention removal, LLM-label tail strip, emoji removal, repeated-punct
  // collapse, ellipsis truncation. Cards cap at 60 chars so a long sentence
  // title doesn't push two cards into three lines.
  const stripped = displayTitle(a.title, 60);
  const cleanTitle = stripped || (a.category ? `${a.category} · 无标题内容` : '无标题内容');
  // Summary uses the same strict displayTitle cleanup as the headline — for
  // X / Reddit ingests the "summary" is just the post text again, so it
  // suffers from the same emoji / hashtag-chain / arrow-decoration garbage
  // that ruined the H1 case. Cap at 100 chars (vs 60 for the title) since
  // summary lives on a multi-line clamp and benefits from a bit more room.
  const rawSummary = displayTitle(a.summary, 100);
  const cleanSummary = summaryIsDuplicate(cleanTitle, rawSummary) ? null : rawSummary;

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
          <img src={thumb} alt={cleanTitle} loading="lazy" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 4, background: '#0f172a', flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: '#e2e8f0', lineHeight: 1.45 }}>{cleanTitle}</h3>
          {cleanSummary && (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {cleanSummary}
            </p>
          )}
          <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {a.category && <span style={{ color: '#a5b4fc' }}>{a.category}</span>}
            {date && <span>{date}</span>}
            <span>{minutes} 分钟阅读</span>
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
        <img src={thumb} alt={cleanTitle} loading="lazy" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', background: '#0f172a', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '3/2', background: '#0f172a' }} />
      )}
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
          {a.category && <span style={{ color: '#a5b4fc', fontWeight: 600 }}>{a.category}</span>}
          {a.category && <span style={{ color: '#475569' }}>·</span>}
          <span>{minutes} 分钟阅读</span>
          {date && <><span style={{ color: '#475569' }}>·</span><span>{date}</span></>}
        </div>
        {/* Summary <p> intentionally not rendered in the card grid. The
            classify-title agent typically copies the post text into both
            `title` and `summary`, so the line below the H2 usually echoed
            the headline (or worse, leaked emoji / hashtag chains that
            displayTitle didn't reach in time). The H2 + meta row is enough
            for browse — readers click through for detail. The `row` layout
            above keeps its summary because it's used in admin/list contexts
            with more horizontal room. */}
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, lineHeight: 1.4, color: '#e2e8f0' }}>{cleanTitle}</h2>
      </div>
    </Link>
  );
}
