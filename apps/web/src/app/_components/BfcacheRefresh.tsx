'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 只处理一种边缘场景:浏览器 back / forward 命中 bfcache 时,Next 拿不到
 * pageshow 之后的 router 事件 — 这里手动 router.refresh() 拉一次。
 *
 * SPA 内的 router.back() / Link 跳转交给 Next 自己处理 — next.config 里
 * staleTimes.dynamic=0 强制每次都重新 fetch server data,counts 自然新鲜,
 * 而且 Next 的 native 滚动还原会把用户落到返回前的位置,不会被甩到页首。
 */
export function BfcacheRefresh() {
  const router = useRouter();
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);
  return null;
}
