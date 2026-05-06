import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from './lib/auth';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const password = process.env.ADMIN_PASSWORD;
  // No password set → local dev, allow all
  if (!password) return NextResponse.next();

  const username = process.env.ADMIN_USER ?? 'admin';

  // /api/admin/* gets rewritten to Fastify by next.config.mjs. We inject
  // the verified username so the backend's op-log records who did what.
  const passThrough = (operator: string): NextResponse => {
    const requestHeaders = new Headers(req.headers);
    // Fastify's op-log reads `x-operator` directly. Strip any client-supplied
    // value to prevent spoofing, then set it from the verified identity.
    requestHeaders.set('x-operator', operator);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  // 1. Cookie auth (browser sessions)
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken) {
    const user = await verifyToken(cookieToken);
    if (user) return passThrough(user);
  }

  // 2. Basic Auth fallback (Prometheus scraping, programmatic access)
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    const sep = decoded.indexOf(':');
    const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const p = sep >= 0 ? decoded.slice(sep + 1) : '';
    if (safeEqual(u, username) && safeEqual(p, password)) return passThrough(u);
  }

  // 3. API routes → 401; page routes → redirect to /login
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isApi) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*', '/workbench/:path*', '/workbench', '/api/admin/:path*'],
};
