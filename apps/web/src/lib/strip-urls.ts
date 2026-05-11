/**
 * Strip clutter from public-facing content. Two flavours:
 *
 *  - stripUrlsFromText() — plain-text fields (title, summary).
 *  - stripUrlsFromHtml() — content_html (also drops <a href="http..."> tags).
 *
 * Removes:
 *   1. Absolute http(s) URLs        — RSS / X feeds dump these mid-text.
 *   2. X-style @handle mentions     — "@user_name" up to 15 ASCII chars; safe
 *      against email addresses thanks to the negative look-behind on word
 *      chars (so "john@example.com" is left alone).
 *
 * Conservative: relative links, mailto:, tel:, in-site /a/..., and the email
 * "@" pattern stay untouched.
 */

const ABS_URL = /https?:\/\/\S+/gi;
// X handle: 1-15 ASCII letters/digits/underscores, must NOT be preceded by a
// word char (which is the email pattern: "name@domain") and must end on a word
// boundary so "@user_name." matches "@user_name" and leaves "." behind.
const X_MENTION = /(?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,15}\b/g;

export function stripUrlsFromText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(ABS_URL, '')
    .replace(X_MENTION, '')
    .replace(/\s+([,.!?;:。！？；：])/g, '$1')   // tighten "word , word" → "word, word"
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strip "caption-like" paragraphs that aren't wrapped in <figcaption>.
 * Common markers used by RSS / blog articles to label embedded images:
 *   图: / 图1: / 图片： / 照片: / 摄: / 拍摄:
 *   Photo: / Image: / Source: / Credit:
 *   via @user / via XXX / (via ...)
 *   © 2024 ...
 *   来源: / 出处: / 图片来自:
 *
 * Only matches <p> tags whose visible text *starts* with one of these markers
 * AND contains no other tags (so we don't accidentally drop a paragraph that
 * happens to mention the word "图" mid-sentence). Conservative on purpose.
 */
const CAPTION_PATTERN_HEAD =
  /^\s*(?:图\s*\d*\s*[:：.、]|图片\s*[:：]|照片\s*[:：]|摄\s*[:：]|拍摄\s*[:：]|来源\s*[:：]|出处\s*[:：]|图片来自|这是配图|配图|插图\s*[:：]?|Photo\s*:|Image\s*:|Source\s*:|Credit\s*:|via\s+[@\w]|©\s*\d{4})/i;

export function stripCaptionParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*>([^<]+)<\/p>/gi, (full, text: string) => {
    return CAPTION_PATTERN_HEAD.test(text) ? '' : full;
  });
}

/**
 * Quick check for "is this plain text effectively an image caption". Reuses
 * the same prefix patterns as <p> caption stripping so behaviour stays in
 * sync. Used for the article page's summary <p> which lives outside the
 * <article> body and isn't reachable by stripCaptionParagraphs().
 */
export function looksLikeCaption(text: string | null | undefined): boolean {
  if (!text) return false;
  return CAPTION_PATTERN_HEAD.test(text);
}

/**
 * Spam / promo markers commonly attached to user-generated content scraped
 * from social platforms (especially adult-content X / Twitter accounts).
 * Any one match → the surrounding <p> / line is treated as boilerplate and
 * dropped. Keep tight — false positives delete real article text.
 */
const SPAM_PATTERNS: RegExp[] = [
  /🔥[\s\S]{0,40}🔥/u,                                          // 🔥 番茄社区APP 🔥
  /[❤💕💖💗💓][\s\S]{0,40}[❤💕💖💗💓]/u,                         // ❤️ XXX ❤️
  /下载\s*(?:链接|地址|app|APP|来)/i,                              // 下载链接 / 下载地址 / 下载来
  /(?:大秀|裸聊|福利)\s*直播|24\s*小时\s*(?:直播|大秀|全天)|全天\s*大秀/, // 大秀直播 / 24小时直播 / 全天大秀
  /成人\s*(?:直播|裸聊|下载|社区|APP|app)/,                        // 成人直播 / 成人 APP
  /(?:有(?:性|兴)趣|老司机)\s*(?:的)?\s*(?:哥哥|兄弟|大佬|大哥)/,    // 有性趣的哥哥们 / 老司机大佬
  /(?:支持|关注)\s*(?:下|一下)\s*[哦呢啊吧噢喔]/,                   // 支持下哦 / 关注一下啊
  /(?:加|联系|扫码|添加)\s*(?:我|微信|VX|vx|wx|WX|QQ|qq|TG|tg|联系方式)/i, // 加微信 / 扫码加我
  /(?:^|\n)\s*(?:#[^\s#]{1,30}\s+){3,}#?/,                        // 4+ 连续 hashtag 堆砌
];

function looksLikeSpam(text: string): boolean {
  return SPAM_PATTERNS.some((p) => p.test(text));
}

/**
 * Drop <p> tags whose text content matches any SPAM_PATTERNS. Same shape as
 * stripCaptionParagraphs — only touches text-only paragraphs (no inner
 * markup) so we don't accidentally tear out richly-formatted content that
 * happens to mention "下载".
 */
export function stripSpamParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*>([^<]+)<\/p>/gi, (full, text: string) => {
    return looksLikeSpam(text) ? '' : full;
  });
}

/**
 * Plain-text version: split on line breaks, drop lines that look like spam.
 * Used by callers rendering raw content (no HTML) — e.g. the article body
 * fallback path, summary previews on cards, etc.
 */
export function stripSpamLines(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .filter((line) => !looksLikeSpam(line))
    .join('\n');
}

export function stripUrlsFromHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    // Drop <a> wrapping http/https — keep the inner text? Usually it's the URL
    // itself, so dropping the whole tag is fine and saves a regex pass.
    .replace(/<a\s+[^>]*href=["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, '')
    // Raw URLs and @mentions in text nodes (RSS / X sources inline them).
    .replace(ABS_URL, '')
    .replace(X_MENTION, '')
    // Common cleanup after stripping: empty tags + trailing whitespace noise
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br/><br/>');
}
