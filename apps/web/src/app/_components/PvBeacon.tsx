'use client';

import { useEffect } from 'react';

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
  useEffect(() => {
    if (!slug) return;
    // sessionStorage:同一标签页内重复刷新只算一次 PV
    const key = `pv:${slug}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    const url = `/api/pv/${encodeURIComponent(slug)}`;
    try {
      if (typeof navigator.sendBeacon === 'function') {
        // sendBeacon 强制 POST + 不阻塞页面卸载,无视 CORS preflight
        const ok = navigator.sendBeacon(url);
        if (ok) return;
      }
      // 老浏览器降级:fetch keepalive
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
    } catch {
      // 极端环境(沙箱 / 老 Safari)直接 noop,不抛错
    }
  }, [slug]);

  return null;
}
