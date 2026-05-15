import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { invalidate } from '../../../lib/cache';

/**
 * On-demand ISR invalidation. The Publishing Agent POSTs here after it
 * updates `items.published_url` so the article / home / sitemap drop cache.
 *
 * Auth: shared secret via header. Set REVALIDATE_SECRET in both api and web
 * .env.
 */
export async function POST(req: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'revalidation not configured' }, { status: 503 });
  }
  const got = req.headers.get('x-revalidate-secret');
  if (got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { paths?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const paths = (body.paths ?? []).filter((p): p is string => typeof p === 'string' && p.startsWith('/'));
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      // ignore individual failures
    }
  }

  // Drop matching entries from our Redis SSR cache (lib/feed.ts cached()).
  // Without this, a publish flushes Next's ISR but Redis keeps serving stale
  // tag counts / hot list for up to FEED_CACHE_TTL. Mapping is deliberately
  // explicit — over-broad SCAN+DEL would risk stomping unrelated keys and
  // costs round-trips we don't need.
  const keys = new Set<string>();
  for (const p of paths) {
    if (p === '/') {
      keys.add('latest:12');
      keys.add('hot:6:7');
      keys.add('hot:8:7');
      // 首页主查询是 getFiltered(sort=hot,limit=20,page=0..3)。一次 publish
      // 影响所有 sort × media × 前几页的组合。
      for (const sort of ['hot', 'latest']) {
        for (const media of ['', 'video', 'image']) {
          for (let pg = 0; pg < 4; pg++) {
            keys.add(`filtered:${sort}:${media}::::20:${pg * 20}`);
          }
        }
      }
      // 类目导航条:三个 scope 都失效。
      keys.add('catnav:all');
      keys.add('catnav:video');
      keys.add('catnav:image');
    } else if (p === '/tag' || p.startsWith('/tag/')) {
      keys.add('tags:30');
      keys.add('tags:200');
      // /tag/<slug> 上的 getFiltered 缓存(tag 字段固定,前几页)
      if (p.startsWith('/tag/')) {
        const tag = decodeURIComponent(p.slice('/tag/'.length));
        for (const sort of ['hot', 'latest']) {
          for (let pg = 0; pg < 3; pg++) {
            keys.add(`filtered:${sort}::${tag}:::20:${pg * 20}`);
          }
        }
      }
    } else if (p.startsWith('/category/')) {
      const cat = decodeURIComponent(p.slice('/category/'.length));
      keys.add(`kw:cat:${cat}:20`);
      keys.add('catnav:all');
      // 分类页 getFiltered 缓存
      for (const sort of ['hot', 'latest']) {
        for (let pg = 0; pg < 3; pg++) {
          keys.add(`filtered:${sort}::${''}:${cat}::20:${pg * 20}`);
        }
      }
    } else if (p === '/sitemap.xml') {
      keys.add('tags:200');
    }
  }
  if (keys.size > 0) {
    await invalidate(...keys);
  }
  return NextResponse.json({ revalidated: paths });
}
