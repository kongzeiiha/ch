// Public media URL rewriting. Two concerns the article page has to handle:
//
//   1. MinIO video URLs were stored as `${S3_ENDPOINT}/${BUCKET}/<key>` by
//      ingestion. In dev that's localhost:9000 — fine for the local browser.
//      In prod, user browsers can't reach the API host's localhost, so any
//      URL that points at the configured MinIO endpoint must be rewritten to
//      our `/m/<key>` API proxy which streams the bytes server-side.
//
//   2. Image URLs from X CDN / 2ksg / knit are hot-link-protected. Direct
//      <img> loads fail with empty/forbidden responses. The API has a public
//      `/img-proxy` route that fetches with the right Referer/Cookie headers
//      per the source's platform. Hand it the source_id when known.
//
// Both proxies live behind /api/* (rewritten to the API in dev/SSR; supply
// NEXT_PUBLIC_API_URL with an absolute URL for static-export builds).

const API_BASE   = process.env.NEXT_PUBLIC_API_URL   ?? '/api';
const MINIO_BASE = process.env.NEXT_PUBLIC_MINIO_BASE ?? 'http://localhost:9000';
const MEDIA_BUCKET = process.env.NEXT_PUBLIC_MEDIA_BUCKET ?? 'ch-media';

const MINIO_BUCKET_PREFIX = `${MINIO_BASE}/${MEDIA_BUCKET}/`;

function isMinioUrl(url: string): boolean {
  return url.startsWith(MINIO_BUCKET_PREFIX);
}

/** Rewrite a MinIO/S3 URL to the public `/m/<key>` proxy. Pass-through for
 *  any URL that doesn't point at the configured MinIO endpoint. */
export function proxiedMedia(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!isMinioUrl(url)) return url;
  const key = url.slice(MINIO_BUCKET_PREFIX.length);
  return `${API_BASE}/m/${key}`;
}

/** Wrap a remote image URL in the `/img-proxy` route so hot-link-protected
 *  hosts (X CDN, 2ksg, knit, …) can be served from this origin. MinIO URLs
 *  shortcut through `proxiedMedia` since they don't need the header dance.
 *  Non-http(s) values (data: URIs, etc.) pass through unchanged. */
export function proxiedImage(
  url: string | undefined | null,
  sourceId?: string | null,
): string | undefined {
  if (!url) return undefined;
  if (isMinioUrl(url)) return proxiedMedia(url);
  if (!/^https?:\/\//i.test(url)) return url;
  const params = new URLSearchParams({ url });
  if (sourceId) params.set('source_id', sourceId);
  return `${API_BASE}/img-proxy?${params.toString()}`;
}
