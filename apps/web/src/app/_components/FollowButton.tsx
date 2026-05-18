'use client';

import { useState, useEffect } from 'react';
import { X } from './theme';

// 关注按钮 — 因为站点没有用户系统,关注状态只存在 localStorage 里。
// 给用户一个"我已收藏这个博主"的本地标记,后续可以做"我关注的"feed 页。
//
// LS key:"followed-sources" → JSON.stringify(string[]) 一个 source_id 数组
const LS_KEY = 'followed-sources';

function readSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSet(s: Set<string>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...s])); } catch {}
  // 同 tab 内其他 island(FollowCountBadge / FollowedTick)靠这个事件 rerender。
  // storage 事件只跨 tab 触发,所以这里手动派发。
  try { window.dispatchEvent(new Event('followed-change')); } catch {}
}

export function FollowButton({ sourceId }: { sourceId: string }) {
  const [followed, setFollowed] = useState(false);
  // hydration 不匹配 — SSR 时无法知 LS 状态,默认全 false,挂载后立刻校正
  useEffect(() => { setFollowed(readSet().has(sourceId)); }, [sourceId]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();   // 阻止冒泡触发外层 <Link> 跳转
    e.stopPropagation();
    const set = readSet();
    if (set.has(sourceId)) set.delete(sourceId);
    else set.add(sourceId);
    writeSet(set);
    setFollowed(set.has(sourceId));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      style={{
        padding: '6px 16px',
        borderRadius: 9999,
        border: `1px solid ${followed ? X.borderStrong : X.text}`,
        background: followed ? 'transparent' : X.text,
        color: followed ? X.text : X.page,
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (followed) {
          e.currentTarget.style.borderColor = '#f4212e';
          e.currentTarget.style.color = '#f4212e';
          e.currentTarget.textContent = '取消关注';
        }
      }}
      onMouseLeave={(e) => {
        if (followed) {
          e.currentTarget.style.borderColor = X.borderStrong;
          e.currentTarget.style.color = X.text;
          e.currentTarget.textContent = '已关注';
        }
      }}
    >
      {followed ? '已关注' : '关注'}
    </button>
  );
}
