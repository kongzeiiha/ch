'use client';

import { useRouter } from 'next/navigation';
import { X } from './theme';

// X.com 风格的返回按钮 — 圆形,左上角靠近标题。
// 优先 router.back() 走浏览器历史栈;直接打开详情页(无来源)时 fallback 到 fallbackHref。
export function XBackButton({ fallbackHref = '/' }: { fallbackHref?: string }) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
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
