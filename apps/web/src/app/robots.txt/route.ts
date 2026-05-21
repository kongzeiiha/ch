// Don't import from `lib/db` here — that module bootstraps the MySQL pool,
// and webpack happens to bundle robots.txt and sitemap.xml together. When
// MySQL is unreachable at build time the shared module fails to import,
// taking robots.txt down with it. SITE_URL is just env, read it directly.
const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';

export function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /workbench
Disallow: /login
Disallow: /api/
# /search has noindex meta — let crawlers fetch it and obey the directive
# rather than block + risk rendering bare URLs in SERP.

Sitemap: ${SITE_URL}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
