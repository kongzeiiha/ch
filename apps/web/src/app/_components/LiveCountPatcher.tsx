'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 列表卡片计数实时同步 — 跳过 Next 各种缓存层,直接 hit 后端拿最新值 patch DOM。
 *
 * 流程:
 *   1. 扫页面里所有 `[data-xpost-slug]` 容器,收集 slug 列表
 *   2. POST /api/item-stats { slugs }
 *   3. 拿到 { [slug]: { likes, pv_30d, comment_count } }
 *   4. 逐张卡片找到 `[data-xpost-count="likes|pv|comments"]` 子元素,
 *      把 textContent 替换成最新值
 *
 * 触发时机:
 *   - 组件 mount(每次路由切换 client 重新挂)
 *   - visibilitychange 切回前台
 *   - pageshow persisted=true(浏览器 back/forward 命中 bfcache)
 *
 * 不调 router.refresh、不重新挂 React tree,所以滚动位置完全不动。
 */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 10_000).toFixed(1).replace(/\.0$/, '') + '万';
}

async function syncCounts() {
  if (typeof document === 'undefined') return;
  const cards = document.querySelectorAll<HTMLElement>('[data-xpost-slug]');
  if (cards.length === 0) return;

  // 去重 — 同一 slug 在页面上可能出现多次(相关推荐 / 多列)
  const slugs = Array.from(new Set(
    Array.from(cards).map((el) => el.getAttribute('data-xpost-slug')).filter(Boolean) as string[],
  ));
  if (slugs.length === 0) return;

  let stats: Record<string, { likes: number; pv_30d: number; comment_count: number }>;
  try {
    const r = await fetch('/api/item-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
      cache: 'no-store',
    });
    if (!r.ok) return;
    const d = await r.json();
    stats = d.stats ?? {};
  } catch { return; }

  for (const card of Array.from(cards)) {
    const slug = card.getAttribute('data-xpost-slug');
    if (!slug || !stats[slug]) continue;
    const s = stats[slug];
    const setText = (kind: 'likes' | 'pv' | 'comments', value: number) => {
      const el = card.querySelector<HTMLElement>(`[data-xpost-count="${kind}"]`);
      if (el) el.textContent = fmtCount(value);
    };
    setText('likes', s.likes);
    setText('pv', s.pv_30d);
    setText('comments', s.comment_count);
  }
}

export function LiveCountPatcher() {
  const pathname = usePathname();

  // 路径变化(包括 router.back)时 mount/重挂,触发 sync
  useEffect(() => {
    syncCounts();
  }, [pathname]);

  // 切回前台时再同步一次 — 用户切走标签页一阵子再回来,数字也是最新的
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncCounts();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) syncCounts();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return null;
}
