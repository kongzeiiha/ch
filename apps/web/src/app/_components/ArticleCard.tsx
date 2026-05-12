import Link from 'next/link';
import type { ArticleCardRow } from '../../lib/feed';
import { readMinutes } from '../../lib/feed';
import { proxiedImage } from '../../lib/media';
import { displayTitle } from '../../lib/strip-urls';
import { VideoDurationBadge } from './VideoDurationBadge';
import { X } from './theme';

// Card-grid hover effects need real CSS pseudo-classes; ship as a once-per-app
// <style> via the layout, but for now inline a scoped block here so the
// .b1-card class stays alongside the markup.
const CARD_CSS = `
  .b1-card { transition: border-color 0.15s ease, background 0.15s ease; }
  .b1-card:hover { border-color: ${X.borderStrong}; background: ${X.surfaceHover}; }
  .b1-card:hover .b1-card-title { color: ${X.accent}; }
`;

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
        borderRadius: 16,
        border: `1px solid ${X.border}`,
        background: X.surface,
        color: X.text,
        textDecoration: 'none',
      }}>
        {thumb && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt={cleanTitle} loading="lazy" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 12, background: X.surfaceSoft, display: 'block' }} />
            <MediaBadge hasVideo={a.has_video} hasImage={a.has_image} />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: X.text, lineHeight: 1.4 }}>{cleanTitle}</h3>
          {cleanSummary && (
            <p style={{ fontSize: 14, color: X.textSecondary, margin: '0 0 8px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {cleanSummary}
            </p>
          )}
          <div style={{ fontSize: 13, color: X.textSecondary, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {a.category && <span style={{ color: X.accent, fontWeight: 600 }}>{a.category}</span>}
            {date && <span>{date}</span>}
            {a.has_video && a.video_url ? (
              <VideoDurationBadge src={a.video_url} fallback={`${minutes} 分钟`} />
            ) : (
              <span>{minutes} 分钟阅读</span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CARD_CSS }} />
      <Link href={`/a/${a.slug}`} className="b1-card" style={{
        display: 'block',
        color: X.text,
        textDecoration: 'none',
        border: `1px solid ${X.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: X.surface,
      }}>
        <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={cleanTitle} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', background: X.surfaceSoft, display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: X.surfaceSoft }} />
          )}
          {/* HD/视频/图片 corner pill — top-left */}
          <CornerMediaBadge hasVideo={a.has_video} hasImage={a.has_image} />
          {/* Duration overlay — bottom-right (video only) */}
          {a.has_video && a.video_url && (
            <span style={{
              position: 'absolute', right: 6, bottom: 6,
              padding: '2px 7px', borderRadius: 3,
              background: 'rgba(0,0,0,0.78)', color: '#fff',
              fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.4,
            }}>
              <VideoDurationBadge src={a.video_url} fallback={`${minutes}:00`} />
            </span>
          )}
        </div>
        <div style={{ padding: '10px 12px 12px' }}>
          <h2 className="b1-card-title" style={{
            fontSize: 13, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.45, color: X.text,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            transition: 'color 0.15s',
          }}>{cleanTitle}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: X.textMuted, flexWrap: 'wrap' }}>
            {a.category && <span style={{ color: X.accent, fontWeight: 600 }}>{a.category}</span>}
            {a.category && date && <span>·</span>}
            {date && <span>{date}</span>}
          </div>
        </div>
      </Link>
    </>
  );
}

// Top-left corner badge on cards/rows. Video wins precedence over plain
// image (a video post almost always also has the poster jpg in media_urls,
// but readers care that it plays). No badge when neither flag is set.
//
// Both glyphs are inline SVGs (not emoji) so they render identically across
// macOS / Win / Linux. The 🖼 emoji used to render as a tiny gray rectangle
// on most systems and looked low-contrast against the dark badge bg — the
// solid white SVG sits flush with the "图片" label like the video ▶ does.
function MediaBadge({ hasVideo, hasImage }: { hasVideo: boolean; hasImage: boolean }) {
  // Row layout (admin list) still uses this chunkier badge. Card grid uses
  // CornerMediaBadge below for the tighter 91-style HD pill.
  if (!hasVideo && !hasImage) return null;
  const isVideo = hasVideo;
  const label = isVideo ? '视频' : '图片';
  const bg = isVideo ? 'rgba(220, 38, 38, 0.92)' : 'rgba(99, 102, 241, 0.92)';
  return (
    <span style={{
      position: 'absolute',
      top: 6,
      left: 6,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      background: bg,
      color: '#fff',
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 4,
      lineHeight: 1.4,
      backdropFilter: 'blur(4px)',
    }}>
      {isVideo ? <PlayIcon /> : <ImageIcon />}
      {label}
    </span>
  );
}

// B1 / 91-style compact HD pill for the card grid. Video → 粉红 HD,
// 纯图 → 半透明黑 IMG. Smaller than MediaBadge so it doesn't compete with
// the thumbnail when dozens of cards tile the screen.
function CornerMediaBadge({ hasVideo, hasImage }: { hasVideo: boolean; hasImage: boolean }) {
  if (!hasVideo && !hasImage) return null;
  const isVideo = hasVideo;
  const bg = isVideo ? X.accent : 'rgba(15,23,42,0.85)';
  const label = isVideo ? 'HD' : 'IMG';
  return (
    <span style={{
      position: 'absolute',
      top: 6,
      left: 6,
      padding: '1px 6px',
      background: bg,
      color: '#fff',
      fontSize: 10,
      fontWeight: 800,
      borderRadius: 3,
      letterSpacing: 0.5,
      lineHeight: 1.5,
    }}>{label}</span>
  );
}

/** Filled triangle, the canonical "play" glyph. fill="currentColor" picks
 *  up the badge's `color: #fff` so it always reads as white. */
function PlayIcon({ size = 9 }: { size?: number }) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} fill="currentColor" aria-hidden>
      <polygon points="1.5,0.5 1.5,9.5 9,5" />
    </svg>
  );
}

/** Classic "photo" glyph: rectangle frame + sun + mountain peaks. Tuned to
 *  read clearly at 11px badge size. stroke="currentColor" picks up the
 *  badge's `color: #fff`. */
function ImageIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.2" y="2.2" width="11.6" height="9.6" rx="1.2" />
      <circle cx="4.6" cy="5.4" r="1" fill="currentColor" stroke="none" />
      <path d="M2 11l3-3.2 2.2 2.2L9.6 7l2.6 2.6" />
    </svg>
  );
}
