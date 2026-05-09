import { SITE_URL } from '../../lib/db';

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
