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

/** Seconds → "M:SS" / "H:MM:SS" — matches the YouTube/Tube glance format
 *  readers recognize. Shared between the bottom-right thumbnail overlay
 *  and the row-layout meta line so they stay in sync. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 1234 → "1.2k", 5678901 → "5.7M". Keeps the card meta line compact when
 *  the corpus accumulates real traffic. Sub-1k counts render exact. */
function formatCount(n: number): string {
  if (!n || n < 1000) return String(n ?? 0);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Inline play/like counts. SVG glyphs (not emoji) so cross-OS rendering is
 *  consistent. Each metric gets its own color so the eye scans them as two
 *  distinct dimensions instead of one muted-grey blob:
 *    - 播放量 → sky blue (#38bdf8), a calm "informational" tone
 *    - 点赞   → accent red (X.accent), matches the LikeButton's filled state
 *  Hides when both are zero so cold-start cards don't show `0 · 0`. */
const PV_COLOR = '#38bdf8';
const LIKE_COLOR = X.accent;

function CardStats({ pv, likes, sep }: { pv: number; likes: number; sep?: boolean }) {
  if (!pv && !likes) return null;
  return (
    <>
      {sep && <span style={{ color: X.borderStrong }}>·</span>}
      {pv > 0 && (
        <span
          title={`${pv} 次播放`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            color: PV_COLOR, fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden style={{ flexShrink: 0 }}>
            <path d="M12 5c-5 0-9 4.4-10 7 1 2.6 5 7 10 7s9-4.4 10-7c-1-2.6-5-7-10-7Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="currentColor"/>
          </svg>
          {formatCount(pv)}
        </span>
      )}
      {likes > 0 && (
        <span
          title={`${likes} 点赞`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            color: LIKE_COLOR, fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden style={{ flexShrink: 0 }}>
            <path d="M12 21s-7-4.35-7-10.5C5 7.42 7.42 5 10.5 5c1.74 0 3.31.81 4.5 2.09C16.19 5.81 17.76 5 19.5 5 22.58 5 25 7.42 25 10.5 25 16.65 12 21 12 21z" transform="translate(-1.5,0)" fill="currentColor"/>
          </svg>
          {formatCount(likes)}
        </span>
      )}
    </>
  );
}

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
  // Prefer server-side duration_sec (populated by ffprobe during ingestion) —
  // ships ready SSR-clean. Fall back to client-side <video> metadata only when
  // DB has no duration (legacy / unprobed items). Avoids the "1 分钟" stuck
  // fallback that 跨域 / 慢网 production users were seeing.
  const dbDuration = a.duration_sec != null && a.duration_sec > 0
    ? formatDuration(a.duration_sec)
    : null;
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
          <div style={{ fontSize: 13, color: X.textSecondary, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {a.category && <span style={{ color: X.accent, fontWeight: 600 }}>{a.category}</span>}
            {date && <span>{date}</span>}
            {a.has_video ? (
              dbDuration ? (
                <span>{dbDuration}</span>
              ) : a.video_url ? (
                <VideoDurationBadge src={a.video_url} fallback={`${minutes} 分钟`} />
              ) : (
                <span>{minutes} 分钟</span>
              )
            ) : (
              <span>{minutes} 分钟阅读</span>
            )}
            <CardStats pv={a.pv_30d} likes={a.likes} />
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
          {/* Duration overlay — bottom-right (video only). Uses DB
              duration_sec when available (SSR-clean, instant); falls back to
              client-side <video preload="metadata"> only when DB is empty. */}
          {a.has_video && (dbDuration ? (
            <span style={{
              position: 'absolute', right: 6, bottom: 6,
              padding: '2px 7px', borderRadius: 3,
              background: 'rgba(0,0,0,0.78)', color: '#fff',
              fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.4,
            }}>{dbDuration}</span>
          ) : a.video_url ? (
            <span style={{
              position: 'absolute', right: 6, bottom: 6,
              padding: '2px 7px', borderRadius: 3,
              background: 'rgba(0,0,0,0.78)', color: '#fff',
              fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.4,
            }}>
              <VideoDurationBadge src={a.video_url} fallback={`${minutes}:00`} />
            </span>
          ) : null)}
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
            <CardStats pv={a.pv_30d} likes={a.likes} sep={!!(a.category || date)} />
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
