import { rssAdapter } from './rss.js';
import { htmlAdapter } from './html.js';
import { json2ksgAdapter } from './json-2ksg.js';
import { knitAdapter } from './knit.js';
import { redditAdapter } from './reddit.js';
import { blueskyAdapter } from './bluesky.js';
import { sitemapImagesAdapter } from './sitemap-images.js';
import { xAdapter } from './x.js';
import type { SourceAdapter } from './types.js';

const registry: Record<string, SourceAdapter> = {
  [rssAdapter.platform]: rssAdapter,
  [htmlAdapter.platform]: htmlAdapter,
  [json2ksgAdapter.platform]: json2ksgAdapter,
  [knitAdapter.platform]: knitAdapter,
  [redditAdapter.platform]: redditAdapter,
  [blueskyAdapter.platform]: blueskyAdapter,
  [sitemapImagesAdapter.platform]: sitemapImagesAdapter,
  [xAdapter.platform]: xAdapter,
};

export function adapterFor(platform: string): SourceAdapter {
  const a = registry[platform];
  if (!a) throw new Error(`no adapter for platform=${platform}`);
  return a;
}

export type { SourceAdapter, SourceRow, RawCandidate } from './types.js';
export { AdapterAuthError } from './types.js';
