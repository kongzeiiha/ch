import { NextRequest, NextResponse } from 'next/server';
import { signToken, COOKIE_NAME, TTL_SECONDS } from '@/lib/auth';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username = '', password = '' } = body as { username?: string; password?: string };

  const expectedUser = process.env.ADMIN_USER ?? 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD ?? '';

  if (!expectedPass || !safeEqual(username, expectedUser) || !safeEqual(password, expectedPass)) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  }

  const token = await signToken(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TTL_SECONDS,
    path: '/',
  });
  return res;
}
