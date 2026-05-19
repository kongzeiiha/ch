'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 文章页点赞按钮 — 客户端组件。
 *
 *   - 挂载时 GET /api/likes/<slug> 读当前计数 + 用户点过没
 *   - 点击 → 乐观更新 UI → POST /api/like/<slug>(或 DELETE 取消)
 *   - 失败回滚乐观更新,展示原始计数
 *   - localStorage 同时持久化"已点过"状态,刷新页面立刻显示已点(避免等异步往返时按钮闪烁)
 *
 * 服务端的真实状态以 Redis 指纹去重为准,localStorage 只是 UX 加速器。
 */
export function LikeButton({ slug, initialLikes }: { slug: string; initialLikes: number }) {
  const router = useRouter();
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const LS_KEY = `liked:${slug}`;

  // 挂载时同步真实状态:计数从 SSR 已带过来,只补一个"用户是否点过"。
  // 这步并不阻塞 UI — 同时用 localStorage 立刻显示乐观结果,避免按钮抖动。
  useEffect(() => {
    if (!slug) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) {
      setLiked(true);
    }
    fetch(`/api/likes/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        if (typeof d.likes === 'number') setLikes(d.likes);
        if (typeof d.liked === 'boolean') setLiked(d.liked);
      })
      .catch(() => {});
    // LS_KEY 是 `liked:${slug}` 派生值,跟 slug 一一对应。只跟 slug 进 deps,
    // 否则 LS_KEY 每次 render 新建一个 string identity,effect 每次都重跑,
    // 既浪费请求也会跟用户点击产生竞态。
  }, [slug]);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const wasLiked = liked;
    // 乐观更新
    setLiked(!wasLiked);
    setLikes((n) => Math.max(0, n + (wasLiked ? -1 : 1)));
    try {
      const r = await fetch(`/api/like/${encodeURIComponent(slug)}`, {
        method: wasLiked ? 'DELETE' : 'POST',
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (typeof d.likes === 'number') setLikes(d.likes);
      if (typeof d.liked === 'boolean') setLiked(d.liked);
      // 持久化已点过状态,刷新页面也能秒识别
      if (typeof localStorage !== 'undefined') {
        if (d.liked) localStorage.setItem(LS_KEY, '1');
        else localStorage.removeItem(LS_KEY);
      }
      // 让当前(文章)页的 RSC payload 失效;返回列表时由 next.config 的
      // staleTimes.dynamic=0 强制重拉 server data,❤️ 计数同步且保留滚动位置。
      router.refresh();
    } catch {
      // 回滚
      setLiked(wasLiked);
      setLikes((n) => Math.max(0, n + (wasLiked ? 1 : -1)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={liked}
      aria-label={liked ? `取消点赞,当前 ${likes} 赞` : `点赞,当前 ${likes} 赞`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 18px',
        background: liked ? '#1d9bf0' : 'transparent',
        border: `1px solid ${liked ? '#1d9bf0' : '#cfd9de'}`,
        borderRadius: 9999,
        color: liked ? '#ffffff' : '#0f1419',
        fontSize: 14,
        fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.7 : 1,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        userSelect: 'none',
      }}
    >
      <Heart filled={liked} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{likes}</span>
    </button>
  );
}

function Heart({ filled }: { filled: boolean }) {
  // 标准心形 SVG — filled=true 时实心,否则只有描边,描边继承父元素 currentColor
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden style={{ flexShrink: 0 }}>
      <path
        d="M12 21s-7-4.35-7-10.5C5 7.42 7.42 5 10.5 5c1.74 0 3.31.81 4.5 2.09C16.19 5.81 17.76 5 19.5 5 22.58 5 25 7.42 25 10.5 25 16.65 12 21 12 21z"
        transform="translate(-1.5,0)"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
