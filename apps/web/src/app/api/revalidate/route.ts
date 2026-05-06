import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

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
  return NextResponse.json({ revalidated: paths });
}
