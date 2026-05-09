import { SITE_URL, SITE_NAME } from './db';

/** Optional brand OG image — used by listing pages (category/tag/topic) when
 *  the page has no specific cover to surface. Article pages keep their own
 *  per-article OG image (cover_sizes.og). */
export const SITE_OG_IMAGE = process.env.SITE_OG_IMAGE;

/** Optional logo URL used by Organization JSON-LD. Should point to a square
 *  image ≥ 112×112 for Google's brand panel. */
export const SITE_LOGO_URL = process.env.SITE_LOGO_URL;

/** Where the AgeGate "离开" button sends users who decline. Exposed via
 *  layout → AgeGate prop so the modal stays a server-driven config. */
export const AGE_GATE_EXIT_URL = process.env.AGE_GATE_EXIT_URL ?? 'https://www.google.com';

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/** BreadcrumbList schema for SERP rich-snippet path display. Pass full URLs
 *  (not paths) so Google can stitch them across origins. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** Site-wide WebSite schema with SearchAction — enables Google's sitelinks
 *  search box for branded queries. */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Organization schema for brand panel / sitelinks logo. */
export function organizationJsonLd() {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
  };
  if (SITE_LOGO_URL) data.logo = SITE_LOGO_URL;
  return data;
}

/** Per-page robots default for indexable long-tail surfaces. Spelling it out
 *  in metadata avoids ambiguity when crawlers see directives elsewhere. */
export const ROBOTS_INDEXABLE = { index: true, follow: true } as const;

/** CollectionPage + ItemList for category/tag/topic listing pages. Helps
 *  Google show rich list previews and understand these are aggregations of
 *  individual articles rather than standalone content. Pass at most ~30
 *  items — beyond that the payload bloats with no SERP benefit. */
export function collectionPageJsonLd(opts: {
  name: string;
  description?: string;
  url: string;
  items: Array<{ title: string; slug: string }>;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: opts.url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/a/${it.slug}`,
        name: it.title,
      })),
    },
  };
}

/** Build OpenGraph images array, falling back to the brand OG image when no
 *  specific cover is available. Returns undefined when neither is set so the
 *  metadata field stays absent rather than rendering an empty tag. */
export function ogImages(specific?: string | null): { url: string; width: number; height: number }[] | undefined {
  const url = specific ?? SITE_OG_IMAGE;
  if (!url) return undefined;
  return [{ url, width: 1200, height: 630 }];
}
