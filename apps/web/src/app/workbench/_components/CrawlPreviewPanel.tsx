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
        border: '1px solid ' + (active ? '#6366f1' : '#3e4144'),
        background: active ? '#6366f1' : 'transparent',
        color: disabled ? '#3e4144' : active ? '#fff' : '#71767b',
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
  // 原文弹窗 — 单独的 state, 不和 media lightbox 复用,因为内容形态完全不同。
  const [textModal, setTextModal] = useState<{ title: string; text: string; source: string; url: string | null } | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A media slot at index i is a "video" when either the URL itself looks
  // like a video file (legacy X data with .mp4/.webm in media_urls) or a
  // playable sidecar lives at video_urls[i] (modern path: poster + mp4 pair).
  const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
  const splitMedia = (it: RawItem) => {
    const images: { url: string; idx: number }[] = [];
    const videos: { url: string; idx: number; sidecar?: string }[] = [];
    (it.media_urls ?? []).forEach((u, i) => {
      const sidecar = it.video_urls?.[i] || it.video_urls?.[0];
      if (isVideoUrl(u) || sidecar) videos.push({ url: u, idx: i, sidecar });
      else images.push({ url: u, idx: i });
    });
    return { images, videos };
  };

  let totalImages = 0;
  let totalVideos = 0;
  let publishedCount = 0;
  for (const it of items) {
    const { images, videos } = splitMedia(it);
    totalImages += images.length;
    totalVideos += videos.length;
    if (it.item_status === 'PUBLISHED' || it.item_status === 'DISTRIBUTED') publishedCount++;
  }

  // Status → badge color/label. Anything we don't recognize falls back to a
  // neutral chip so a future status added in the API doesn't crash the panel.
  const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
    PUBLISHED:         { label: '已上站',     bg: '#16a34a33', fg: '#86efac' },
    DISTRIBUTED:       { label: '已分发',     bg: '#16a34a33', fg: '#86efac' },
    COMPLIANCE_PASS:   { label: '待发布',     bg: '#0ea5e933', fg: '#7dd3fc' },
    COMPLIANCE_REVIEW: { label: '人工待审',   bg: '#f59e0b33', fg: '#fcd34d' },
    COMPLIANCE_FAIL:   { label: '合规拦截',   bg: '#1d9bf033', fg: '#fca5a5' },
    COVERED:           { label: '封面已生成', bg: '#71767b33', fg: '#e7e9ea' },
    TITLED:            { label: '标题已生成', bg: '#71767b33', fg: '#e7e9ea' },
    CLASSIFIED:        { label: '已分类',     bg: '#71767b33', fg: '#e7e9ea' },
    INGESTED:          { label: '已采集',     bg: '#3e414444', fg: '#71767b' },
  };
  const renderStatusBadge = (status: string | null) => {
    if (!status) {
      return (
        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#3e414444', color: '#71767b' }}
          title="raw_items 行存在,但没有对应的 items 行(去重前已被过滤,或事务异常)">
          未入库
        </span>
      );
    }
    const meta = STATUS_BADGE[status] ?? { label: status, bg: '#3e414444', fg: '#e7e9ea' };
    return (
      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: meta.bg, color: meta.fg, fontWeight: 600 }}
        title={`items.status = ${status}`}>
        {meta.label}
      </span>
    );
  };

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
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #3e4144', background: '#1e293b', color: '#e7e9ea', fontSize: 13, minWidth: 240 }}
        >
          <option value="">全部采集源</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>{s.name} · {s.platform}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#71767b', cursor: 'pointer' }}>
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
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #3e4144', background: 'transparent', color: '#71767b', fontSize: 12, cursor: 'pointer' }}
        >
          ↻ 刷新
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#71767b' }}>
          共 <span style={{ color: '#e7e9ea', fontWeight: 600 }}>{total}</span> 条
          · 本页 <span style={{ color: '#e7e9ea', fontWeight: 600 }}>{totalImages}</span> 张图
          · <span style={{ color: '#e7e9ea', fontWeight: 600 }}>{totalVideos}</span> 个视频
          · 已上站 <span style={{ color: '#86efac', fontWeight: 600 }}>{publishedCount}</span>/{items.length}
        </div>
      </div>

      {loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>加载中…</div>
      )}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569', background: '#0f172a', borderRadius: 10, border: '1px dashed #3e4144' }}>
          暂无数据
        </div>
      )}

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map(it => (
          <div key={it.id} style={{ background: '#1e293b', border: '1px solid #3e4144', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, fontWeight: 600, color: '#e7e9ea', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={it.title || it.url || ''}>
                {it.title || it.url || '(无标题)'}
              </div>
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{it.platform}</span>
              {renderStatusBadge(it.item_status)}
              <span style={{ fontSize: 11, color: '#71767b' }}>{it.source_name}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{fmtTime(it.fetched_at)}</span>
              {it.original_text && it.original_text.trim() && (
                <button
                  onClick={() => setTextModal({
                    title: it.title || it.url || '(无标题)',
                    text: it.original_text!,
                    source: it.source_name,
                    url: it.url,
                  })}
                  title="查看采集到的原文(清洗后)"
                  style={{ fontSize: 11, color: '#fbbf24', background: 'transparent', border: '1px solid #78350f', borderRadius: 5, padding: '1px 7px', cursor: 'pointer' }}>
                  📄 原文
                </button>
              )}
              {(it.item_status === 'PUBLISHED' || it.item_status === 'DISTRIBUTED') && it.item_slug && (
                <a href={`/a/${it.item_slug}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: '#86efac', textDecoration: 'none' }}>↗ 站点</a>
              )}
            </div>

            {(() => {
              const { images, videos } = splitMedia(it);
              if (images.length === 0 && videos.length === 0) {
                return <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>(无媒体)</div>;
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {images.length > 0 && (
                    <section>
                      <div style={{ fontSize: 11, color: '#71767b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ padding: '1px 7px', borderRadius: 6, background: '#22c55e22', color: '#86efac', fontWeight: 600 }}>
                          图片 {images.length}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                        {images.map(({ url, idx }) => (
                          <div key={idx}
                            onClick={() => setPreview({ url, sourceId: it.source_id, title: it.title || it.url || '' })}
                            style={{
                              position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                              background: '#0f172a', border: '1px solid #3e4144', cursor: 'pointer',
                            }}
                            title={url}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={proxied(url, it.source_id)} alt="" loading="lazy"
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
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {videos.length > 0 && (
                    <section>
                      <div style={{ fontSize: 11, color: '#71767b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ padding: '1px 7px', borderRadius: 6, background: '#a855f733', color: '#d8b4fe', fontWeight: 600 }}>
                          视频 {videos.length}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                        {videos.map(({ url, idx, sidecar }) => {
                          // Legacy: media_urls itself is the .mp4 — no poster to render, open in new tab.
                          if (isVideoUrl(url) && !sidecar) {
                            return (
                              <a key={idx} href={url} target="_blank" rel="noreferrer"
                                title={`视频:${url}`}
                                style={{
                                  position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                                  background: '#1e293b', border: '1px solid #3e4144', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexDirection: 'column', gap: 6, color: '#71767b', fontSize: 11, textDecoration: 'none',
                                }}>
                                <span style={{ fontSize: 32 }}>🎥</span>
                                <span>视频(点击打开)</span>
                              </a>
                            );
                          }
                          // Poster + sidecar mp4 — click plays in lightbox.
                          return (
                            <div key={idx}
                              onClick={() => setPreview({ url, sourceId: it.source_id, title: it.title || it.url || '', videoUrl: sidecar })}
                              style={{
                                position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                                background: '#0f172a', border: '1px solid #3e4144', cursor: 'pointer',
                              }}
                              title={`视频海报 — 点击播放\n${url}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={proxied(url, it.source_id)} alt="" loading="lazy"
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
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              );
            })()}
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

          <span style={{ marginLeft: 12, fontSize: 12, color: '#71767b' }}>第 {page + 1} / {totalPages} 页</span>
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Explicit download button — Chrome's native video kebab menu has
                  become unreliable for cross-origin sources, so we ship our own.
                  `download` attribute on a same-origin (proxied) URL forces a
                  Save dialog instead of inline navigation. */}
              {(() => {
                const dlSrc = preview.videoUrl
                  ? proxied(preview.videoUrl, preview.sourceId)
                  : proxied(preview.url, preview.sourceId);
                const ext = preview.videoUrl
                  ? (preview.videoUrl.split('?')[0]!.split('.').pop() ?? 'mp4').toLowerCase()
                  : (preview.url.split('?')[0]!.split('.').pop() ?? 'jpg').toLowerCase();
                const safeName = (preview.title || 'media').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
                const filename = `${safeName}.${ext}`;
                return (
                  <a
                    href={dlSrc}
                    download={filename}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 6,
                      background: '#6366f1', color: '#fff',
                      fontSize: 12, fontWeight: 600, textDecoration: 'none',
                    }}>
                    ⬇ 下载{preview.videoUrl ? '视频' : '图片'}
                  </a>
                );
              })()}
              <a
                href={preview.videoUrl ?? preview.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 6,
                  background: 'transparent', color: '#71767b',
                  border: '1px solid #3e4144',
                  fontSize: 12, fontWeight: 500, textDecoration: 'none',
                }}>
                ↗ 原始链接
              </a>
              <div style={{ flex: 1, fontSize: 10.5, color: '#71767b', wordBreak: 'break-all', minWidth: 0 }}>
                {preview.videoUrl ?? preview.url}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 原文 modal — 纯文本(清洗后),最大 4000 字,溢出滚动 */}
      {textModal && (
        <div onClick={() => setTextModal(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto', background: '#0f172a', border: '1px solid #78350f', borderRadius: 12, padding: '20px 24px', cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: '#fbbf24', fontSize: 14, fontWeight: 700 }}>📄 原文</h3>
              <button onClick={() => setTextModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#71767b', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
                ×
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #1e293b' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{textModal.title}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{textModal.source}</span>
                {textModal.url && (
                  <a href={textModal.url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: 11 }}>
                    ↗ 原始链接
                  </a>
                )}
              </div>
            </div>
            <pre style={{
              margin: 0,
              fontSize: 13, lineHeight: 1.7, color: '#e2e8f0',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif',
            }}>{textModal.text}</pre>
            {textModal.text.length >= 4000 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
                (已截断到 4000 字 · 完整内容请去站点文章页)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
