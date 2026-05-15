'use client';

import { useEffect, useState } from 'react';

/**
 * Single global lightbox for the reader site. Mounted once per page; uses
 * event delegation so we don't have to wrap every <img> individually:
 *
 *   - Listens for clicks on the document
 *   - Triggers when the click target lives inside `.article-body img`,
 *     `.lightbox-img`, or `[data-lightbox] img`
 *   - Prefers `img.dataset.full` (higher-res variant if the caller set one)
 *     and falls back to `img.src`
 *   - ESC or overlay click closes
 *
 * No portal — the modal sits at the bottom of the React tree with
 * `position: fixed` covering the viewport.
 */
export function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const img = target.closest<HTMLImageElement>('.article-body img, .lightbox-img, [data-lightbox] img');
      if (!img) return;
      // If the image is wrapped in an <a>, prevent navigation so we open the
      // lightbox instead of leaving the page.
      const link = target.closest('a');
      if (link) e.preventDefault();
      e.stopPropagation();
      setSrc(img.dataset.full ?? img.src);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSrc(null);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!src) return null;
  return (
    <div
      onClick={() => setSrc(null)}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.88)',
        zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, cursor: 'zoom-out',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw', maxHeight: '92vh',
          borderRadius: 6,
          background: '#000',
          objectFit: 'contain',
          boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
          cursor: 'default',
        }}
      />
      {/* 左上角返回按钮 — 符合 X.com 全屏图片查看器的位置惯例,
          点击或按 ESC 都能关闭。半透明黑底 + 描边在任何亮度图片上都可读。 */}
      <button
        onClick={(e) => { e.stopPropagation(); setSrc(null); }}
        aria-label="返回"
        style={{
          position: 'absolute', top: 16, left: 20,
          background: 'rgba(0,0,0,0.6)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 999, width: 38, height: 38,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
    </div>
  );
}
