import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from './lib/auth';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 后台路径(workbench / admin / 后端 admin API)集中在这里 —— 用 host 分流时
// 公开域名访问这些路径会被直接 404,不暴露入口存在。任何前缀匹配,所以
// /workbench/anything、/admin/x/y、/api/admin/abc 都覆盖。
const ADMIN_PATH_PREFIXES = ['/workbench', '/admin', '/api/admin'];

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// ADMIN_HOSTS: 逗号分隔的运营专用 host 名单(裸 hostname,不含端口/协议)。
// 命中其中之一 → 当前请求来自"后台域名",workbench/admin 入口可见。
// 未命中 → 公开域名,后台路径一律 404。
// 空 / 未设 → 不做 host 区分(开发或单域名部署仍可访问后台,只看 cookie)。
function isAdminHost(host: string | null): boolean {
  const list = (process.env.ADMIN_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true; // 未配置 → 视为允许,等同旧行为
  const h = (host ?? '').split(':')[0].toLowerCase();
  return list.includes(h);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const password = process.env.ADMIN_PASSWORD;
  // No password set → local dev, allow all
  if (!password) return NextResponse.next();

  const username = process.env.ADMIN_USER ?? 'admin';

  // Host 分流: 公开域名上的后台路径直接 404,不进鉴权环节也不暴露存在。
  // 注意要在 cookie 检查之前 —— 即使带着合法 cookie 从公开域名访问 /workbench
  // 也应该 404,因为公开域名根本不该提供运营入口。
  if (isAdminPath(req.nextUrl.pathname) && !isAdminHost(req.headers.get('host'))) {
    return new NextResponse(null, { status: 404 });
  }

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

// 全站 gate:除 /login 页面 + /api/auth/* 登录端点 + Next 静态资源 + favicon 之外,
// 所有路由都要 cookie / Basic Auth。这样未登录访客打开站点直接跳 /login,
// 即便手敲 /workbench /admin /a/<slug> /tag /search 等也一样。
// (regex 用负 lookahead — 写作 alternative list 时 Next 不支持。)
export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon).*)'],
};
