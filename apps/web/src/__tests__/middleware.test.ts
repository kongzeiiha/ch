import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware.js';

// verifyToken is async (Web Crypto) — stub it out so tests don't need real HMAC
vi.mock('../lib/auth.js', () => ({
  COOKIE_NAME: 'ch_auth',
  verifyToken: vi.fn().mockResolvedValue(null), // no valid cookie by default
  signToken: vi.fn(),
  TTL_SECONDS: 604800,
}));

function makeReq(headers: Record<string, string> = {}, path = '/admin/page'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('middleware auth', () => {
  const ENV = { pwd: process.env.ADMIN_PASSWORD, usr: process.env.ADMIN_USER };

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'secret';
    delete process.env.ADMIN_USER;
  });

  afterEach(() => {
    if (ENV.pwd === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = ENV.pwd;
    if (ENV.usr === undefined) delete process.env.ADMIN_USER;
    else process.env.ADMIN_USER = ENV.usr;
    vi.clearAllMocks();
  });

  it('passes through without auth check when ADMIN_PASSWORD is not set', async () => {
    delete process.env.ADMIN_PASSWORD;
    const res = await middleware(makeReq());
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('allows correct username and password via Basic Auth', async () => {
    const res = await middleware(makeReq({ authorization: basicAuthHeader('admin', 'secret') }));
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('redirects page routes to /login when no auth', async () => {
    const res = await middleware(makeReq());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('returns 401 for API routes when no auth', async () => {
    const res = await middleware(makeReq({}, '/api/admin/foo'));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('blocks wrong password', async () => {
    const res = await middleware(makeReq({ authorization: basicAuthHeader('admin', 'wrong') }));
    expect(res.status).toBe(307);
  });

  it('blocks wrong username', async () => {
    const res = await middleware(makeReq({ authorization: basicAuthHeader('root', 'secret') }));
    expect(res.status).toBe(307);
  });

  it('allows passwords that contain colons (regression for split(":") bug)', async () => {
    process.env.ADMIN_PASSWORD = 'pass:word:with:colons';
    const res = await middleware(makeReq({ authorization: basicAuthHeader('admin', 'pass:word:with:colons') }));
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('rejects a truncated password that matched the old split(":") bug', async () => {
    process.env.ADMIN_PASSWORD = 'pass:word';
    const res = await middleware(makeReq({ authorization: basicAuthHeader('admin', 'pass') }));
    expect(res.status).toBe(307);
  });

  it('respects custom ADMIN_USER', async () => {
    process.env.ADMIN_USER = 'operator';
    const ok = await middleware(makeReq({ authorization: basicAuthHeader('operator', 'secret') }));
    const blocked = await middleware(makeReq({ authorization: basicAuthHeader('admin', 'secret') }));
    expect(ok.headers.get('WWW-Authenticate')).toBeNull();
    expect(blocked.status).toBe(307);
  });
});
