'use client';

import { useRouter } from 'next/navigation';
import { X } from './theme';

// X.com 风格的返回按钮 — 圆形,左上角靠近标题。
//
// 之前判 `window.history.length > 1` 用来决定 back vs push, 但 history.length
// 在 dev / 直接打开链接 / 新标签页 / 浏览器后退到首屏 等多种场景下不靠谱:
//   - 新标签页打开:length=1 但 router.back() 会去之前的页, 误判
//   - 刷新过的 SPA:length 不变, 但 referrer 是空, back() 实际 no-op
//   - 隐私窗 / WebView:length 行为各异
// 结果:用户点了 ← 啥都不发生(已知 bug)。
//
// 现在策略:先无条件 router.back(),200ms 内 pathname 没变(说明 back no-op)再
// router.push(fallbackHref) 兜底。两次成功不会发生,因为 push 会被 dedupe。
export function XBackButton({ fallbackHref = '/' }: { fallbackHref?: string }) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window === 'undefined') return;
    const beforePath = window.location.pathname + window.location.search;
    try { router.back(); } catch { /* router 偶尔抛 — 走兜底 */ }
    // back 是异步的, pathname 不会同步变。等一小段时间检查; 没变就直接 push。
    window.setTimeout(() => {
      const nowPath = window.location.pathname + window.location.search;
      if (nowPath === beforePath) router.push(fallbackHref);
    }, 250);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="返回"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        borderRadius: '50%',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: X.text,
        flexShrink: 0,
        marginRight: 12,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = X.surfaceHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
