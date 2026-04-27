import Parser from 'rss-parser';
import axios from 'axios';
import type { SourceAdapter, SourceRow, RawCandidate } from './types.js';

const parser = new Parser({
  timeout: 15_000,
  headers: { 'User-Agent': 'ch-agents/0.1 (+ingestion)' },
});

const http = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': 'ch-agents/0.1 (+ingestion)' },
  maxRedirects: 5,
  validateStatus: (s) => s >= 200 && s < 400,
});

// Node's http library rejects URLs containing raw non-ASCII (e.g. Chinese in
// a Google News search URL). Re-encode host + path + query so they are safe.
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // URL constructor percent-encodes path/search/hash for us — toString() gives a safe form.
    return u.toString();
  } catch {
    return raw;
  }
}

export const rssAdapter: SourceAdapter = {
  platform: 'rss',

  async fetch(source: SourceRow): Promise<RawCandidate[]> {
    const feedUrl = source.config.feed_url ?? source.url;
    if (!feedUrl) throw new Error(`source ${source.id} missing feed_url`);

    const feed = await parser.parseURL(safeUrl(feedUrl));
    const limit = Number(source.config.limit ?? 30);
    const items = feed.items.slice(0, limit);

    const results: RawCandidate[] = [];
    for (const item of items) {
      const url = item.link ?? item.guid;
      if (!url) continue;

      let html: string | undefined;

      // Google News RSS links are SPA redirects — fetching the URL returns an
      // HTML shell that only resolves via JS, so we can't extract the real
      // article. Fall back to the item title + description directly.
      const isSpaShell =
        /news\.google\.com\/(rss\/)?articles/i.test(url) ||
        /news\.google\.com\/(rss\/)?read/i.test(url);

      if (isSpaShell) {
        // Build plain text from title + snippet + source. Main loop will skip
        // Readability when RawCandidate.text is set.
        const snippet = (item.contentSnippet ?? item.summary ?? '').trim();
        const sourceName = item.creator ?? (item as any).source ?? '';
        const parts = [item.title, snippet, sourceName ? `来源：${sourceName}` : null]
          .filter(Boolean) as string[];
        const text = parts.join('\n\n');
        results.push({
          url,
          externalId: item.guid ?? url,
          title: item.title,
          publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
          text,
          extra: { rss_categories: item.categories, feed_title: feed.title, spa: true },
        });
        continue;
      } else {
        // Normal path — refetch the article page.
        try {
          const res = await http.get<string>(safeUrl(url), { responseType: 'text' });
          html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        } catch (e: any) {
          html = item['content:encoded'] ?? item.content ?? item.contentSnippet;
        }
      }

      results.push({
        url,
        externalId: item.guid ?? url,
        title: item.title,
        publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
        html,
        extra: { rss_categories: item.categories, feed_title: feed.title },
      });
    }
    return results;
  },
};
