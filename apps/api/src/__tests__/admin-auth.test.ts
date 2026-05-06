import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerAdminAuth } from '../admin-auth.js';

async function buildApp(token: string | undefined) {
  const app = Fastify({ logger: false });
  process.env.ADMIN_TOKEN = token ?? '';
  registerAdminAuth(app);
  app.get('/admin/test', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('registerAdminAuth', () => {
  const ORIGINAL = process.env.ADMIN_TOKEN;
  afterEach(() => {
    process.env.ADMIN_TOKEN = ORIGINAL;
  });

  it('allows requests when ADMIN_TOKEN is not set', async () => {
    const app = await buildApp(undefined);
    const res = await app.inject({ method: 'GET', url: '/admin/test' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('blocks /admin/* without token', async () => {
    const app = await buildApp('secret123');
    const res = await app.inject({ method: 'GET', url: '/admin/test' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('allows /admin/* with correct Bearer token', async () => {
    const app = await buildApp('secret123');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { authorization: 'Bearer secret123' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows /admin/* with correct x-admin-token header', async () => {
    const app = await buildApp('secret123');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { 'x-admin-token': 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('blocks /admin/* with wrong token', async () => {
    const app = await buildApp('secret123');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('does not affect non-admin routes', async () => {
    const app = await buildApp('secret123');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
