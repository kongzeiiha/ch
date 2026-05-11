'use client';

import { useEffect, useRef, useState } from 'react';
import { proxiedMedia } from '../../lib/media';

/**
 * Renders the real playback duration of a video by mounting an offscreen
 * `<video preload="metadata">` and reading `videoElement.duration` once the
 * browser's metadata range request resolves.
 *
 * Card-grid usage: ~24 cards × ~50KB metadata fetch each — modern browsers
 * coalesce and the requests are HTTP range, not full-file downloads, so the
 * network cost is bounded. The fallback (`{fallback}`) renders SSR-clean and
 * stays put if loading times out or the source 404s, so search engines /
 * non-JS clients always see something sensible.
 *
 * `crossOrigin="anonymous"` would let us read from cross-origin sources but
 * trips up CDNs that don't return CORS headers; metadata fetch works fine
 * without it, the browser just won't expose drawing/timing details — and we
 * only need .duration, which is always exposed.
 */
export function VideoDurationBadge({
  src,
  fallback,
}: {
  src: string;
  fallback: string;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Guard: some browsers fire loadedmetadata immediately if the video was
    // already in cache and we missed the event during mount. Pull readyState
    // right away as a backup.
    if (el.readyState >= 1 && Number.isFinite(el.duration)) {
      setDuration(el.duration);
    }
  }, []);

  // We never actually play. preload="metadata" is enough — Chrome / Firefox /
  // Safari all return duration after the initial range request resolves.
  return (
    <>
      {/* Off-screen audio-less probe. Width/height 0 + position absolute
          keeps it from affecting layout. Display "none" would block
          metadata loading in some browsers — keep it rendered. */}
      <video
        ref={ref}
        src={proxiedMedia(src) ?? src}
        preload="metadata"
        muted
        playsInline
        aria-hidden
        tabIndex={-1}
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLVideoElement).duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onError={() => setFailed(true)}
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <span>{duration && !failed ? formatDuration(duration) : fallback}</span>
    </>
  );
}

/** Render seconds as `M:SS` for short clips and `H:MM:SS` for >1h videos.
 *  Matches the de-facto YouTube format readers recognize at a glance. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
