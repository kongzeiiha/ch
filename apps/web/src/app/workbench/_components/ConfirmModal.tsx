'use client';

import type { ReactNode } from 'react';

export interface ConfirmRequest {
  title: string;
  /** Plain string or pre-built ReactNode for richer messages. */
  body: ReactNode;
  /** Danger variant uses red accent + red confirm button (delete / unpublish / etc). */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
}

export function ConfirmModal({ req }: { req: ConfirmRequest | null }) {
  if (!req) return null;

  const accent = req.danger ? '#7f1d1d' : '#6366f1';
  const confirmBg = req.danger ? '#7f1d1d' : '#6366f1';
  const confirmFg = req.danger ? '#fecaca' : '#ffffff';
  const confirmHoverBg = req.danger ? '#991b1b' : '#4f46e5';

  const close = (ok: boolean) => req.resolve(ok);

  return (
    <div
      onClick={() => close(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      }}
      style={{
        position: 'fixed', inset: 0, background: '#000a', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: '#1e293b', border: `1px solid ${accent}`, borderRadius: 10,
          padding: 20, width: '100%', maxWidth: 440,
          boxShadow: '0 20px 60px -10px #000c',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>{req.danger ? '⚠️' : '❓'}</span>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{req.title}</div>
        </div>
        <div style={{
          fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 18,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{req.body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => close(false)}
            autoFocus
            style={{
              padding: '7px 16px', borderRadius: 6, border: '1px solid #334155',
              background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
            }}
          >{req.cancelLabel ?? '取消'}</button>
          <button
            onClick={() => close(true)}
            onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = confirmHoverBg; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = confirmBg; }}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              background: confirmBg, color: confirmFg, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >{req.confirmLabel ?? '确认'}</button>
        </div>
      </div>
    </div>
  );
}
