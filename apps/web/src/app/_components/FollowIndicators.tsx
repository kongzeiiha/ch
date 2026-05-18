'use client';

import { useState, useEffect } from 'react';
import { X } from './theme';

// 这一文件托管几个小型客户端孤岛(islands),全部依赖 localStorage 里的
// "followed-sources" 数组。三者共享:
//   - storage 事件订阅:别的 tab / 别的组件改了 LS,这里自动跟新
//   - 同一份解析逻辑,避免每个组件各自读各自的
//
// 没有用户系统,关注集存在浏览器里;这些组件只是把这个集渲染到 UI 上。
const LS_KEY = 'followed-sources';

function readSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

/** Hook:订阅 LS 关注集,storage 事件 + 自定义 'followed-change' 事件触发 rerender。
 *  自定义事件:同 tab 内 FollowButton 触发改写后,会派发它让本 tab 其他孤岛跟着更新
 *  (storage 事件只跨 tab,不能通知同 tab)。 */
function useFollowedSet(): Set<string> {
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSet(readSet());
    const refresh = () => setSet(readSet());
    window.addEventListener('storage', refresh);
    window.addEventListener('followed-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('followed-change', refresh);
    };
  }, []);
  return set;
}

/** 「已关注」√ 徽标 — XPost 头部用,小一号。只在 LS 集合命中时显示;否则 null。 */
export function FollowedTick({ sourceId }: { sourceId: string }) {
  const set = useFollowedSet();
  if (!set.has(sourceId)) return null;
  return (
    <span title="已关注" aria-label="已关注" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 14, height: 14, marginLeft: 2,
      color: X.accent, flexShrink: 0,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M22.5 12.5c0-1.6-.9-3-2.2-3.7.2-.6.3-1.2.3-1.8 0-2.8-2.2-5-5-5-.8 0-1.5.2-2.2.5-.9-1.5-2.5-2.5-4.4-2.5-2.8 0-5 2.2-5 5 0 .6.1 1.2.3 1.8C2.9 7.5 2 9 2 10.5c0 1.4.7 2.6 1.9 3.4-.1.4-.2.8-.2 1.3 0 2.5 1.9 4.6 4.4 4.9.6 1.6 2.1 2.8 3.9 2.8.8 0 1.5-.2 2.1-.6.6.4 1.4.6 2.1.6 1.8 0 3.3-1.2 3.9-2.8 2.5-.3 4.4-2.4 4.4-4.9 0-.4-.1-.9-.2-1.3 1.2-.7 1.9-2 1.9-3.4Zm-12 5.6L6 13.6l1.3-1.6 3.1 3 6.3-7.3 1.5 1.3-7.7 9.1Z" />
      </svg>
    </span>
  );
}

/** 左侧导航「关注」边上的数字 badge — 0 关注时不显示,避免空 chip 占位。 */
export function FollowCountBadge() {
  const set = useFollowedSet();
  if (set.size === 0) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 22, height: 18, padding: '0 6px',
      background: X.accent, color: '#ffffff',
      borderRadius: 9999,
      fontSize: 11, fontWeight: 800,
      fontVariantNumeric: 'tabular-nums',
      marginLeft: 'auto',
    }}>{set.size > 99 ? '99+' : set.size}</span>
  );
}
