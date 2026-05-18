'use client';

import { useState } from 'react';
import { X } from './theme';
import { ShareIcon } from './XIcons';

// X.com 风格的分享按钮 — 点击复制文章链接到剪贴板,1.5s 后回正常态。
// 现代浏览器走 navigator.share()(原生 iOS/Android share sheet),桌面降级到
// clipboard 复制。
//
// 整个 XPost 是个 <Link>,这里 stopPropagation 阻止冒泡,免得点了分享反而跳转。
export function ShareButton({ slug, title }: { slug: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/a/${encodeURIComponent(slug)}`;

    // 优先 Web Share API(手机自带 share sheet 体验最好)
    if (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function') {
      try {
        await (navigator as any).share({ title, url });
        return;
      } catch { /* 用户取消 / 接口不可用,fallback */ }
    }
    // fallback:复制链接
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API 不可用(HTTP 非安全域 / 极老浏览器):降级 prompt 让用户手抄
      // 大部分生产场景走不到这里,只是兜底
      window.prompt('复制此链接', url);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? '链接已复制' : '分享'}
      title={copied ? '链接已复制' : '复制链接'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: 0,
        background: 'transparent',
        border: 'none',
        color: copied ? X.success : X.textMuted,
        fontSize: 13,
        fontFamily: 'inherit',
        cursor: 'pointer',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {copied ? (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 5 5L20 7" />
          </svg>
          <span style={{ fontSize: 12 }}>已复制</span>
        </>
      ) : (
        <ShareIcon />
      )}
    </button>
  );
}
