import { JSDOM } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';

export interface Cleaned {
  title: string | null;
  excerpt: string | null;
  content: string;       // plain text
  contentHtml: string;   // sanitized HTML
  mediaUrls: string[];
  length: number;
}

/**
 * Run Mozilla Readability against raw HTML and collect image URLs found
 * inside the extracted article. Resolves relative URLs against the page URL.
 */
export function clean(html: string, pageUrl: string): Cleaned | null {
  if (!html || html.length < 200) return null;

  const dom = new JSDOM(html, { url: pageUrl });
  const doc = dom.window.document;

  if (!isProbablyReaderable(doc)) {
    // Still try Readability — isProbablyReaderable is a heuristic and misses
    // some feed-driven articles that are actually fine.
  }

  const reader = new Readability(doc);
  const article = reader.parse();
  if (!article || !article.textContent) return null;

  const mediaUrls: string[] = [];
  if (article.content) {
    const articleDom = new JSDOM(article.content, { url: pageUrl });
    const imgs = articleDom.window.document.querySelectorAll('img');
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src) {
        try {
          mediaUrls.push(new URL(src, pageUrl).toString());
        } catch {
          // skip invalid img src
        }
      }
    });
  }

  const text = article.textContent.replace(/\s+/g, ' ').trim();

  return {
    title: article.title ?? null,
    excerpt: article.excerpt ?? null,
    content: text,
    contentHtml: article.content ?? '',
    mediaUrls: Array.from(new Set(mediaUrls)),
    length: text.length,
  };
}
