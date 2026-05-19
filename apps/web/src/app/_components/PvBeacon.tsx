'use client';

import { useEffect, useRef } from 'react';

/**
 * 文章页 PV 埋点 — 渲染后 fire-and-forget 一次 POST /api/pv/<slug>。
 *
 * 设计要点:
 *   - 用 navigator.sendBeacon() 优先,即使用户秒关页面也能保证请求到达。
 *   - sessionStorage 防同会话重复计数(刷新页面不重复算 PV)。
 *   - 错误静默吞掉,不影响阅读体验。
 *   - 客户端组件,服务端不参与;爬虫 SSR 时不会触发(也避免污染统计)。
 */
export function PvBeacon({ slug }: { slug: string }) {
  // React Strict Mode(dev 下默认开)会把 useEffect 跑两次, sendBeacon 会发两次
  // → 一次浏览 +2 PV。用 ref 锁住,同一 slug 在本组件生命周期内只 fire 一次。
  // 重复阅读仍然算 +1(用户重新进文章页 → 组件重新挂 → ref 重置)。
  const firedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    if (firedSlugRef.current === slug) return;
    firedSlugRef.current = slug;

    const url = `/api/pv/${encodeURIComponent(slug)}`;
    try {
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url);
      } else {
        fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch { /* 沙箱 / 老 Safari noop */ }
  }, [slug]);

  return null;
}
