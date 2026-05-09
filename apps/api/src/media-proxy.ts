import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { query } from '@ch/db';

// ─── S3 / MinIO client ────────────────────────────────────────────────────────
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const S3_BUCKET   = process.env.S3_BUCKET   ?? 'ch-media';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
  forcePathStyle: true,
});

// ─── Cookie hostname allow-list ─────────────────────────────────────────────
// Cookies must never be forwarded to a hostname that doesn't belong to the
// platform — that would let a stranger exfiltrate platform credentials by
// crafting a `?url=...` pointing at their own host.
const COOKIE_ALLOWED: Record<string, RegExp> = {
  knit: /(?:^|\.)knit\.bid$/,
  x:    /(?:^|\.)(?:twimg\.com|x\.com|twitter\.com)$/,
};

/**
 * Shared handler for proxying a remote image with platform-aware Referer /
 * Cookie / UA headers, range support, and hot-link detection. Used by both
 * the admin /admin/proxy-image route (workbench preview) and the public
 * /img-proxy route (article page video posters & gallery).
 */
export async function proxyImageHandler(
  req: FastifyRequest<{ Querystring: { url?: string; source_id?: string } }>,
  reply: FastifyReply,
) {
  const remoteUrl = req.query.url;
  const sourceId  = req.query.source_id;
  if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) {
    return reply.code(400).send({ error: 'bad url' });
  }

  // Best-effort source lookup for header customization.
  let platform = '';
  let cfg: Record<string, unknown> = {};
  if (sourceId) {
    const rows = await query<{ platform: string; config: Record<string, unknown> }>(
      `SELECT platform, config FROM sources WHERE id = $1`,
      [sourceId],
    );
    if (rows[0]) { platform = rows[0].platform; cfg = rows[0].config ?? {}; }
  }

  const ua = (cfg.userAgent as string) ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };

  let remoteHost = '';
  try { remoteHost = new URL(remoteUrl).hostname; } catch { /* invalid url caught earlier */ }

  if (platform === '2ksg') {
    headers['Referer'] = (cfg.referer as string) || 'https://uib.2ksg.com/';
  } else if (platform === 'knit') {
    headers['Referer'] = 'https://xx.knit.bid/';
    if (cfg.cookie && COOKIE_ALLOWED.knit!.test(remoteHost)) headers['Cookie'] = cfg.cookie as string;
  } else if (platform === 'x') {
    headers['Referer'] = 'https://x.com/';
    if (cfg.cookie && COOKIE_ALLOWED.x!.test(remoteHost)) headers['Cookie'] = cfg.cookie as string;
  } else {
    // Unknown platform — guess a Referer matching the remote host so naive
    // hot-link checks (Referer must equal own domain) at least pass.
    if (remoteHost) headers['Referer'] = `https://${remoteHost}/`;
  }

  try {
    const rangeHeader = req.headers['range'];
    if (typeof rangeHeader === 'string') headers['Range'] = rangeHeader;

    const upstream = await fetch(remoteUrl, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return reply.code(upstream.status).send({ error: 'upstream', status: upstream.status });
    }
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ar = upstream.headers.get('accept-ranges');

    if (cl !== null && Number(cl) === 0) {
      return reply.code(502).send({ error: 'empty body — likely hotlink-blocked' });
    }

    reply
      .code(upstream.status)
      .header('Content-Type', ct)
      .header('Cache-Control', 'public, max-age=86400');
    if (cl) reply.header('Content-Length', cl);
    if (cr) reply.header('Content-Range', cr);
    if (ar) reply.header('Accept-Ranges', ar);

    if (!upstream.body) return reply.send(Buffer.alloc(0));
    const { Readable } = await import('node:stream');
    return reply.send(Readable.fromWeb(upstream.body as any));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return reply.code(502).send({ error: 'fetch fail', detail: msg });
  }
}

/**
 * Stream an object out of the configured S3/MinIO bucket. URL form:
 *   /m/<key>   (key may contain slashes, e.g. videos/<uuid>/0.mp4)
 *
 * The ingestion worker stores video URLs as `${S3_ENDPOINT}/${BUCKET}/<key>`
 * which works in dev (localhost:9000 resolves to MinIO) but breaks in prod
 * because user browsers can't reach the API host's localhost. The article
 * page rewrites those URLs to `/m/<key>` so the bytes flow through the API.
 *
 * Cache headers assume MinIO objects are immutable (ingestion writes once
 * with a content-hash slug), so we set the longest sensible TTL.
 */
async function mediaStreamHandler(
  req: FastifyRequest<{ Params: { '*': string } }>,
  reply: FastifyReply,
) {
  const key = req.params['*'];
  if (!key || key.includes('..')) return reply.code(400).send({ error: 'bad key' });

  try {
    const range = req.headers['range'] as string | undefined;
    const out = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ...(range ? { Range: range } : {}),
    }));

    const code = range && out.ContentRange ? 206 : 200;
    reply.code(code);
    if (out.ContentType)              reply.header('Content-Type', out.ContentType);
    if (out.ContentLength != null)    reply.header('Content-Length', out.ContentLength);
    if (out.ContentRange)             reply.header('Content-Range', out.ContentRange);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');

    return reply.send(out.Body as Readable);
  } catch (e: any) {
    const code = e?.$metadata?.httpStatusCode ?? 502;
    return reply.code(code).send({ error: 'fetch fail', detail: e?.message ?? String(e) });
  }
}

export async function registerMediaProxy(app: FastifyInstance): Promise<void> {
  // Public image proxy — same logic as /admin/proxy-image, no auth gate.
  app.get<{ Querystring: { url?: string; source_id?: string } }>(
    '/img-proxy',
    proxyImageHandler,
  );

  // MinIO/S3 stream proxy.
  app.get<{ Params: { '*': string } }>('/m/*', mediaStreamHandler);
}
