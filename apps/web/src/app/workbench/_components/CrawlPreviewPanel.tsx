'use client';

import { useState } from 'react';
import type { Source, RawItem } from './types';
import { API } from './constants';
import { pageNumbers } from './utils';

function PageBtn({
  label, active, disabled, onClick,
}: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 10px',
        minWidth: 32,
        borderRadius: 6,
        border: '1px solid ' + (active ? '#6366f1' : '#334155'),
        background: active ? '#6366f1' : 'transparent',
        color: disabled ? '#334155' : active ? '#fff' : '#94a3b8',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{label}</button>
  );
}

export function CrawlPreviewPanel({
  sources, items, total, loading, sourceId, withMedia, page, pageSize,
  onSourceChange, onWithMediaChange, onPageChange, onRefresh,
}: {
  sources: Source[];
  items: RawItem[];
  total: number;
  loading: boolean;
  sourceId: string;
  withMedia: boolean;
  page: number;
  pageSize: number;
  onSourceChange: (id: string) => void;
  onWithMediaChange: (v: boolean) => void;
  onPageChange: (p: number) => void;
  onRefresh: () => void;
}) {
  const [preview, setPreview] = useState<{ url: string; sourceId: string; title: string; videoUrl?: string } | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totalImages = items.reduce((n, it) => n + (it.media_urls?.length ?? 0), 0);

  // Both 2ksg (Referer check) and knit (cf_clearance) block direct browser
  // image loads. Route them through the API proxy with the right headers.
  const proxied = (remoteUrl: string, sourceId: string) =>
    `${API}/admin/proxy-image?source_id=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(remoteUrl)}`;

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={sourceId}
          onChange={(e) => onSourceChange(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, minWidth: 240 }}
        >
          <option value="">全部采集源</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>{s.name} · {s.platform}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={withMedia}
            onChange={(e) => onWithMediaChange(e.target.checked)}
            style={{ accentColor: '#6366f1' }}
          />
          仅显示有图片的条目
        </label>

        <button
          onClick={onRefresh}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}
        >
          ↻ 刷新
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          共 <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{total}</span> 条
          · 本页 <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{totalImages}</span> 张图
        </div>
      </div>

      {loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>加载中…</div>
      )}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569', background: '#0f172a', borderRadius: 10, border: '1px dashed #334155' }}>
          暂无数据
        </div>
      )}

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map(it => (
          <div key={it.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={it.title || it.url || ''}>
                {it.title || it.url || '(无标题)'}
              </div>
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{it.platform}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{it.source_name}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{fmtTime(it.fetched_at)}</span>
              {it.url && (
                <a href={it.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>↗ 原文</a>
              )}
            </div>

            {it.media_urls && it.media_urls.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {it.media_urls.map((u, i) => {
                  // Legacy data: some early X items wrote .mp4 / .webm into
                  // media_urls itself. <img> can't render videos — show a poster card.
                  const urlIsVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
                  // Modern X path: media_urls[i] is a poster jpg + parallel
                  // video_urls[i] is the playable mp4. Surface as a click-to-play.
                  const sidecarVideo = it.video_urls?.[i] || it.video_urls?.[0];
                  const hasPlayable = !!sidecarVideo;

                  if (urlIsVideo) {
                    return (
                      <a key={i} href={u} target="_blank" rel="noreferrer"
                        title={`视频:${u}`}
                        style={{
                          position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                          background: '#1e293b', border: '1px solid #334155', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexDirection: 'column', gap: 6, color: '#94a3b8', fontSize: 11, textDecoration: 'none',
                        }}>
                        <span style={{ fontSize: 32 }}>🎥</span>
                        <span>视频(点击打开)</span>
                      </a>
                    );
                  }
                  return (
                    <div key={i}
                      onClick={() => setPreview({ url: u, sourceId: it.source_id, title: it.title || it.url || '', videoUrl: sidecarVideo })}
                      style={{
                        position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                        background: '#0f172a', border: '1px solid #334155', cursor: 'pointer',
                      }}
                      title={hasPlayable ? `视频海报 — 点击播放\n${u}` : u}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proxied(u, it.source_id)} alt="" loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.style.display = 'none';
                          const parent = el.parentElement;
                          if (parent && !parent.querySelector('.fallback')) {
                            const fb = document.createElement('div');
                            fb.className = 'fallback';
                            fb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#475569;text-align:center;padding:8px;';
                            fb.textContent = '加载失败';
                            parent.appendChild(fb);
                          }
                        }}
                      />
                      {hasPlayable && (
                        <div style={{
                          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          pointerEvents: 'none',
                        }}>
                          <div style={{
                            background: 'rgba(0,0,0,0.55)', borderRadius: '50%',
                            width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 18, color: '#fff',
                          }}>▶</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>(无图片)</div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 20, flexWrap: 'wrap' }}>
          <PageBtn label="« 首页" disabled={page === 0} onClick={() => onPageChange(0)} />
          <PageBtn label="‹ 上一页" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))} />

          {pageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} style={{ padding: '5px 6px', fontSize: 12, color: '#475569' }}>…</span>
            ) : (
              <PageBtn
                key={p}
                label={String(p + 1)}
                active={p === page}
                onClick={() => onPageChange(p)}
              />
            ),
          )}

          <PageBtn label="下一页 ›" disabled={page >= totalPages - 1} onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} />
          <PageBtn label="末页 »" disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)} />

          <span style={{ marginLeft: 12, fontSize: 12, color: '#64748b' }}>第 {page + 1} / {totalPages} 页</span>
        </div>
      )}

      {/* Lightbox */}
      {preview && (
        <div onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'default' }}>
            {preview.videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video controls autoPlay
                src={proxied(preview.videoUrl, preview.sourceId)}
                poster={proxied(preview.url, preview.sourceId)}
                style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, background: '#000' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proxied(preview.url, preview.sourceId)} alt={preview.title}
                style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, background: '#000', objectFit: 'contain' }} />
            )}
            <div style={{ fontSize: 11, color: '#cbd5e1', wordBreak: 'break-all', background: '#1e293b', padding: '6px 10px', borderRadius: 6, lineHeight: 1.7 }}>
              {preview.videoUrl
                ? <>视频:<a href={preview.videoUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{preview.videoUrl}</a></>
                : <>原始 URL:<a href={preview.url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{preview.url}</a></>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
