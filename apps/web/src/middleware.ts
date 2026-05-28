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

  // 运营域名上访问根路径 / 时直接跳 /workbench —— 运营从 admin.xbozhu.com 进来
  // 显然是要找工作台,没必要先看公开首页。仅在 ADMIN_HOSTS 显式配置且当前
  // host 命中白名单时生效;dev/单域名部署不受影响。
  if (req.nextUrl.pathname === '/') {
    const list = (process.env.ADMIN_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const h = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
    if (list.length > 0 && list.includes(h)) {
      const url = req.nextUrl.clone();
      url.pathname = '/workbench';
      return NextResponse.redirect(url);
    }
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

// 全站 gate,但**公开内容只读 API 必须放行**,否则文章页 CommentSection 等
// 客户端组件即便用户已登录,fetch 命中 middleware 时也会被拦掉(实际场景常见:
// 客户端 SameSite/分号格式问题、读 cookie 延迟、新 tab 异步水合阶段没拿到
// cookie)—— 总之 read-only 公开数据没必要走鉴权,否则一旦 cookie 链路有
// 任何抖动评论 / 点赞 / 浏览数 / 图片代理全废。
//
// 白名单(均为读类公共内容,无副作用):
//   /api/external-comments  X 评论同步快照
//   /api/comments           本站匿名评论(写入有自己的 rate-limit + ad-filter)
//   /api/likes              点赞计数读
//   /api/item-stats         批量计数读
//   /api/img-proxy          封面 / 图片代理(去 X CDN 反爬)
//   /api/m                  movies (视频源) 重定向
//   /api/pv                 浏览数 beacon
//   /api/revalidate         publishing worker 回调(自己有 secret)
//
// 仍 gate 的:页面路由(/、/a/*、/tag/*、/search ...)+ /api/admin/* + /workbench /admin。
export const config = {
  matcher: [
    '/((?!login|api/auth|api/external-comments|api/comments|api/likes|api/item-stats|api/img-proxy|api/m|api/pv|api/revalidate|_next/static|_next/image|favicon).*)',
  ],
};
