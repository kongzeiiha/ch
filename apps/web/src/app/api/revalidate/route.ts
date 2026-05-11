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
    } else if (p === '/tag' || p.startsWith('/tag/')) {
      // /tag (index) reads getTopTags(200); footer/header read getTopTags(30).
      keys.add('tags:30');
      keys.add('tags:200');
    } else if (p.startsWith('/category/')) {
      const cat = decodeURIComponent(p.slice('/category/'.length));
      keys.add(`kw:cat:${cat}:20`);
    } else if (p === '/sitemap.xml') {
      keys.add('tags:200');
    }
  }
  if (keys.size > 0) {
    await invalidate(...keys);
  }
  return NextResponse.json({ revalidated: paths });
}
