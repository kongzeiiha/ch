import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Protects every route under /admin with a static bearer token.
 * Set ADMIN_TOKEN in the environment; if unset the hook logs a warning and
 * lets all traffic through (dev convenience).
 */
export function registerAdminAuth(app: FastifyInstance): void {
  const token = process.env.ADMIN_TOKEN?.trim();
  if (!token) {
    app.log.warn('[admin-auth] ADMIN_TOKEN not set — admin routes are unprotected');
    return;
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin')) return;

    const auth = req.headers['authorization'];
    const provided = auth?.startsWith('Bearer ')
      ? auth.slice(7)
      : (req.headers['x-admin-token'] as string | undefined);

    const match =
      provided != null &&
      provided.length === token.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    if (!match) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });
}
