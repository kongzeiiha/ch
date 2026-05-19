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

// Full http(s) URL. Conservative: requires both slashes and non-empty path.
const ABS_URL = /https?:\/\/\S+/gi;
// Broken URL fragment left by upstream truncation: anything that starts with
// `http:` or `https:` followed by 0+ non-whitespace chars. Catches `https:/`,
// `https:`, `http://...` etc. Safe vs prose like "use HTTPS to connect"
// because we require the `:` — without it, the bare word stays alone.
const BROKEN_URL = /https?:\S*/gi;
// Standalone `http` / `https` word sitting at the very end of the string
// after whitespace — pure URL-truncation remnant in titles like
// "像蝴蝶：粉红街两轮肥皂 https". A mid-text "HTTPS" stays untouched.
const TRAILING_HTTP = /\s+https?\s*$/gi;
// X handle: 1-15 ASCII letters/digits/underscores, must NOT be preceded by a
// word char (which is the email pattern: "name@domain") and must end on a word
// boundary so "@user_name." matches "@user_name" and leaves "." behind.
const X_MENTION = /(?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,15}\b/g;

export function stripUrlsFromText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(ABS_URL, '')
    // Run AFTER ABS_URL: most rows have a complete URL caught by the first
    // regex; BROKEN_URL only mops up upstream-truncated leftovers like
    // `https:/` / `https:` (rare but visible on a few rows).
    .replace(BROKEN_URL, '')
    .replace(X_MENTION, '')
    .replace(TRAILING_HTTP, '')
    .replace(/\s+([,.!?;:。！？；：])/g, '$1')   // tighten "word , word" → "word, word"
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * LLM "afterword" artifacts that often leak into auto-generated titles /
 * summaries. The classify-title agent sometimes appends a meta label like
 *   关键词《不洁之星》 / [关键词:XXX] / Keywords: a, b / 标签:abc
 * after the actual content. These look fine to the model (it's "labelling its
 * own work") but on the public site they expose the LLM's internal taxonomy
 * and visibly degrade the article display.
 *
 * Three patterns, anchored to the END of the string only — we don't want to
 * eat a legitimate mid-text "关键词" that appears as part of the article topic.
 *   1. <label> 《XXX》             — angle-bracket-wrapped value
 *   2. [<label>:XXX] / (<label>:XXX) — bracketed key:value
 *   3. <label>: XXX                — bare key:value (greediest, run last)
 *
 * Title/summary only. Don't apply to body text — articles legitimately
 * discuss "关键词" / "keywords" / "tags" mid-paragraph.
 */
const LLM_LABELS = '关键词|关键字|关 键 词|标签|分类|主题|话题|题材|Tags?|Keywords?|Category|Topic';

const LLM_ARTIFACT_PATTERNS: RegExp[] = [
  // 1. 关键词《XXX》 — chinese book brackets at end
  new RegExp(`\\s*(?:${LLM_LABELS})\\s*《[^》\\n]{1,80}》\\s*$`, 'iu'),
  // 2. [关键词:XXX] / （Keyword: XXX） — bracketed
  new RegExp(`\\s*[\\[\\(（【]\\s*(?:${LLM_LABELS})\\s*[:：]\\s*[^\\]\\)）】\\n]{0,80}[\\]\\)）】]\\s*$`, 'iu'),
  // 3. 关键词:XXX — bare colon-separated trailing tail (run last; greediest)
  new RegExp(`\\s*(?:${LLM_LABELS})\\s*[:：]\\s*[^\\n]{1,80}$`, 'iu'),
];

/**
 * Drop garbage tags/keywords that classify-title sometimes emits — usually
 * one of these three shapes:
 *   - LLM-label artifacts ("关键词《X》", "[Keyword:X]")
 *   - Full sentences accidentally classified as tags (>30 chars + commas /
 *     full-stops — real tags are short noun phrases)
 *   - URL fragments / @handles bleeding in
 *
 * Applied at the data-fetch layer in feed.ts / a/[slug]/loadArticle so all
 * downstream surfaces (article page tag chips, listing-card tag pills,
 * <meta keywords>, JSON-LD keywords) get the same clean array.
 */
// Tag-specific LLM-junk shapes. The title-tail patterns require a closing
// bracket / full key:value form, but the classify-title agent sometimes
// stores TRUNCATED leftovers as their own tag — e.g. "关键词《不洁之星" (no
// closing 》) or just "关键词". For a TAG specifically, any string that
// STARTS with one of the meta labels is junk — real tags are short noun
// phrases like "探花", they never lead with "关键词:" or "Keywords《".
const LLM_TAG_HEAD = new RegExp(`^\\s*(?:${LLM_LABELS})\\s*[:：《【\\[\\(（]?`, 'iu');

export function isJunkTag(tag: string | null | undefined): boolean {
  if (!tag || typeof tag !== 'string') return true;
  const t = tag.trim();
  if (!t) return true;
  // LLM-label artifact (reuse the title-tail patterns; anchored to full
  // string here since the "tag" IS the entire string).
  for (const p of LLM_ARTIFACT_PATTERNS) {
    if (p.test(t)) return true;
  }
  // Tag starts with an LLM meta-label (with or without closing bracket).
  // Catches truncated leftovers the tail-anchored patterns miss.
  if (LLM_TAG_HEAD.test(t)) return true;
  // CJK tags are typically 2-6 characters ("探花", "动漫"). Anything beyond ~10
  // CJK chars is almost certainly a sentence fragment classify-title mistook
  // for a tag. ASCII tags can be longer (e.g. "twitter-marketing"), so we use
  // a separate threshold (30) for those. The CJK detector requires at least
  // one Han ideograph; mixed strings fall back to the ASCII bucket.
  const hasCjk = /[㐀-鿿]/.test(t);
  if (hasCjk && t.length > 10) return true;
  if (!hasCjk && t.length > 30) return true;
  // Sentence punctuation (full-stop / Chinese full-stop / exclamation / Q)
  // inside a tag string is another tell.
  if (/[。！？]/u.test(t)) return true;
  // Bare URLs / @mentions that survived a stripping pass.
  if (ABS_URL.test(t) || X_MENTION.test(t)) {
    // Reset lastIndex — these are /g regexes, .test() mutates state and
    // the next call could return wrong if we don't.
    ABS_URL.lastIndex = 0;
    X_MENTION.lastIndex = 0;
    return true;
  }
  return false;
}

/** Filter an array of tags/keywords through isJunkTag.
 *  也顺手剥掉前缀 # / ＃ (fullwidth U+FF03) — 某些 X / 中文社区把 hash 符当成
 *  标签字面的一部分写进去, 站点显示时再带个 # 视觉很乱; 用户搜索点击时
 *  统一去掉。空字符串(剥完 # 后)直接丢弃。 */
export function cleanTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (isJunkTag(t)) continue;
    const stripped = t.replace(/^[#＃]+/, '').trim();
    if (!stripped) continue;
    const key = stripped.toLowerCase();
    if (seen.has(key)) continue;  // 同篇文章不重复同一个标签
    seen.add(key);
    out.push(stripped);
  }
  return out;
}

/**
 * For social-post ingests (X / Reddit), the "article body" is often just the
 * post text — i.e. a duplicate of the title. Rendering the H1 and then the
 * same sentence again as a <p> looks broken to readers (and stacks weirdly
 * above the video / gallery). This helper normalizes both sides (whitespace,
 * @mentions, HTML tags) and returns true when the body adds no new content.
 * Caller can then skip rendering the body block entirely.
 *
 * A real article body that happens to *open* with the title sentence and
 * then adds 200 more chars of analysis is NOT a duplicate — we measure the
 * extra-content delta and only treat the body as a duplicate when the
 * additional material is small (under 40 chars or under 25% of title length,
 * whichever is larger).
 */
export function bodyDuplicatesTitle(title: string | null | undefined, body: string | null | undefined): boolean {
  if (!body) return true;
  const norm = (s: string) => s
    .replace(/<[^>]+>/g, ' ')        // strip HTML tags
    .replace(/@[A-Za-z0-9_]+/g, '')   // strip @handles
    .replace(/https?:\/\/\S+/g, '')   // strip URLs (X tweets dump t.co links)
    .replace(/\s+/g, '')              // strip all whitespace
    .toLowerCase();
  const t = norm(title ?? '');
  const b = norm(body);
  if (!b) return true;
  if (!t) return false;
  if (t === b) return true;
  // Title fully contains body → body is a strict subset of title (rare, but
  // happens when summary is a truncated title).
  if (t.includes(b)) return true;
  // Body contains title + extra content. Only treat as duplicate when the
  // extra is small — otherwise the body is a genuine elaboration and should
  // render. Threshold scales with title length so a 20-char title doesn't
  // need a 60-char body to escape the heuristic.
  if (b.includes(t)) {
    const extra = b.length - t.length;
    const cutoff = Math.max(40, Math.floor(t.length * 0.25));
    return extra < cutoff;
  }
  return false;
}

/**
 * Strict display cleanup for visible H1 / card titles. Beyond what
 * stripTitleArtifacts handles, this also kills the three classes of noise
 * that show up across the social-feed corpus and make the H1 look broken:
 *
 *   (a) Emoji — engagement bait in the source feed, visual garbage in our
 *       header. Stripped via the Unicode "Emoji_Presentation" property so we
 *       don't have to enumerate codepoints. Symbols/punctuation that happen
 *       to be in the General_Punctuation block (e.g. ⌂, →) are kept.
 *   (b) Repeated terminal punctuation — `....`, `！！！`, `？？？`, `、、、`,
 *       `~~~` and friends. Collapsed to a single mark.
 *   (c) Trailing punctuation soup left behind by upstream truncation —
 *       `…`, `...`, `.. ` at the end. Trimmed.
 *
 * Finally truncates to `maxLen` chars with an ellipsis suffix so a 200-char
 * sentence title doesn't blow up the H1 area. Default 80 fits the standard
 * desktop H1 line.
 *
 * For SEO surfaces (meta description, OG, JSON-LD) keep using
 * stripTitleArtifacts — search engines are fine with emojis and we don't
 * want to ship a different "canonical" title there than the user sees.
 */
const EMOJI_RE = /[\p{Extended_Pictographic}️]/gu;
const REPEAT_PUNCT_RE = /([。！？，、；：~～！？、,!?.;:])\1{1,}/g;

// "Look here ↓" / "↑ ↑ ↑" style decoration noise that X / social feeds tack
// onto titles to drag eyes toward an attached link or media. Always pure
// chrome, never semantic. Single arrows (e.g. "走向→未来") could in theory be
// content; we only kill them when there are TWO OR MORE arrow glyphs in the
// run (with optional whitespace separators), since lone arrows are rare in
// real headlines anyway.
const ARROW_DECO_RE = /(?:[↑↓←→⬆⬇⬅➡⇧⇩⇦⇨▶◀▼▲]+[\s　]*){2,}/gu;

// Hashtag-tail soup: "#a #b #c #d" trailing on a title is a tag dump masking
// as content. Drop runs of 2+ hashtags (both ASCII `#` and FW `＃`). Each
// tag token is up to 30 non-space non-hash chars. Anchored loosely — works
// in the middle or at the end. A single mid-text "#话题" stays.
const HASHTAG_CHAIN_RE = /(?:[#＃][^\s#＃]{1,30}[\s　]+){1,}[#＃][^\s#＃]{0,30}/g;

export function displayTitle(
  text: string | null | undefined,
  maxLen = 80,
): string {
  let t = stripTitleArtifacts(text);
  if (!t) return '';
  t = t.replace(EMOJI_RE, '');
  t = t.replace(ARROW_DECO_RE, ' ');
  t = t.replace(HASHTAG_CHAIN_RE, ' ');
  t = t.replace(REPEAT_PUNCT_RE, '$1');
  // Trim dot-soup / dash / 。 leftovers at the edges. `！？` are kept because
  // they convey tone in headlines ("某标题！" reads fine); `。` is almost
  // always noise on a title — professional Chinese headlines don't
  // terminate with full-stop, and most "garbage" examples we saw end
  // with a stray ".." or "。" left by upstream truncation.
  //
  // Trailing `…` is intentionally OUT of the strip class on the right —
  // when displayTitle truncates a long title it appends `…` as the
  // truncation marker, and a second pass of displayTitle (e.g. backfill +
  // worker write both run the same function) must not eat that marker.
  // Leading `…` IS still stripped — a title that opens with `…` is almost
  // always a continuation marker the LLM left over, not author intent.
  t = t.replace(/^[\s　.…。、，~～\-—]+/u, '');
  t = t.replace(/[\s　.。、，~～\-—]+$/u, '');
  // Collapse runs of whitespace that emoji removal may have left behind
  // (e.g. "a 🔥 b" → "a   b" → "a b").
  t = t.replace(/[\s　]{2,}/g, ' ').trim();
  if (t.length > maxLen) {
    // Slice on a grapheme-ish boundary. JS surrogate pairs are 2 chars; the
    // simple .slice() is safe for BMP + most CJK but can split astral pairs.
    // For our content the title is short enough that this is fine.
    t = `${t.slice(0, maxLen - 1).trimEnd()}…`;
  }
  return t;
}

/** Strip URLs/@mentions AND trailing LLM label artifacts. Use for short
 *  fields surfaced to readers (title, summary). Body text should stick to
 *  stripUrlsFromText() so legit "关键词" mentions aren't eaten. */
export function stripTitleArtifacts(text: string | null | undefined): string {
  let out = stripUrlsFromText(text);
  // Apply each pattern repeatedly — some titles stack multiple tails
  // (e.g. "xxx 关键词《a》 标签:b"). Loop until idempotent or 4 rounds max.
  for (let i = 0; i < 4; i++) {
    let changed = false;
    for (const p of LLM_ARTIFACT_PATTERNS) {
      const stripped = out.replace(p, '');
      if (stripped !== out) { out = stripped; changed = true; }
    }
    if (!changed) break;
  }
  return out.trim();
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

  // LLM-label-only lines (whole-line anchored). The classify-title agent
  // sometimes echoes its internal taxonomy into the article body as a
  // standalone line — e.g. "关键词《不洁之星》". These lines appear in
  // the public article body ABOVE the video / images and read as noise to
  // human readers. ^...$ anchoring + the `i u` flags ensure a legit
  // mid-paragraph mention of "关键词" inside running prose stays intact.
  new RegExp(`^\\s*(?:${LLM_LABELS})\\s*[:：]?\\s*《[^》\\n]{1,80}》\\s*$`, 'iu'),
  new RegExp(`^\\s*[\\[\\(（【]\\s*(?:${LLM_LABELS})\\s*[:：]\\s*[^\\]\\)）】\\n]{0,80}[\\]\\)）】]\\s*$`, 'iu'),
  new RegExp(`^\\s*(?:${LLM_LABELS})\\s*[:：]\\s*[^\\n]{1,80}$`, 'iu'),
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

/** Strip LLM-label tails from running text. Whole-string anchored: only the
 *  tail of the input is touched, mid-text "关键词" mentions stay. Used for:
 *   - <p> inner text after URL stripping (one paragraph at a time)
 *   - plain text content lines via stripSpamLines (each line is a "string")
 *
 *  Also removes lines that are ENTIRELY an LLM-label artifact (so a content
 *  paragraph like "...惩罚\n\n关键词《X》" gets just the trailing line peeled). */
export function stripLLMTails(text: string): string {
  let out = text;
  for (let i = 0; i < 4; i++) {
    let changed = false;
    for (const p of LLM_ARTIFACT_PATTERNS) {
      const stripped = out.replace(p, '');
      if (stripped !== out) { out = stripped; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * Defense-in-depth HTML sanitizer for content rendered via
 * `dangerouslySetInnerHTML`. The article body comes from upstream RSS / API
 * feeds we don't control — a compromised or hostile source could inject
 * `<script>`, event handlers, or `javascript:` URLs that would execute in
 * our origin.
 *
 * Conservative regex-based pass. We considered isomorphic-dompurify (real
 * DOM parser via jsdom) but its server bundle drags ~5MB of jsdom + WHATWG
 * fixtures into every Next.js route's chunks, breaking the build with
 * `ENOENT browser/default-stylesheet.css`. The threat model here is RSS-
 * sourced HTML (not user-controlled), so a strict regex denylist is enough:
 *
 *   1. Drop entire "dangerous" tag blocks (script/iframe/style/object/embed/
 *      form/link/meta/base/svg) including their inner content
 *   2. Strip every `on*=` event handler attribute regardless of host element
 *   3. Replace `javascript:` / `vbscript:` / `data:` in href/src/action/
 *      formaction/xlink:href with a "#" so the attribute survives but goes
 *      nowhere harmful
 *   4. Drop `srcdoc` outright
 *
 * Anything that looks remotely suspicious is dropped — false positives just
 * mean a slightly uglier render, false negatives are XSS. The compliance
 * agent should screen ingested HTML upstream; this is the last-line defense.
 */
const DANGEROUS_TAGS = ['script', 'iframe', 'style', 'object', 'embed', 'form', 'link', 'meta', 'base', 'svg'];

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  let out = html;
  // 1. Strip entire dangerous tag blocks. Non-greedy match keeps adjacent
  //    <script>...</script>...<script>...</script> from being collapsed into
  //    one over-eager removal.
  for (const tag of DANGEROUS_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    // Self-closing / never-closed variants: `<link rel="x">`, `<meta …>`.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>(?![\\s\\S]*<\\/${tag})`, 'gi'), '');
  }
  // 2. Drop inline event handlers (`on*=`) regardless of element.
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 3. Neutralize unsafe URI schemes — replace the value with "#" so the
  //    attribute parses but does nothing. Keeps the attribute name in place
  //    so existing CSS/layout that targets `a[href]` still applies.
  out = out.replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*("|')\s*(?:javascript|vbscript|data):[^"']*\2/gi, ' $1=$2#$2');
  // 4. Drop `srcdoc` — lets <iframe>-like elements embed arbitrary HTML.
  out = out.replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return out;
}

export function stripUrlsFromHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Sanitize FIRST so the rest of the pipeline operates on safe HTML.
  return sanitizeHtml(html)
    // Drop <a> wrapping http/https — keep the inner text? Usually it's the URL
    // itself, so dropping the whole tag is fine and saves a regex pass.
    .replace(/<a\s+[^>]*href=["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, '')
    // Raw URLs and @mentions in text nodes (RSS / X sources inline them).
    .replace(ABS_URL, '')
    .replace(X_MENTION, '')
    // Per-<p> LLM-tail strip — many feeds dump the article body as a single
    // <p> whose tail contains "关键词《XX》" (sometimes after a blank line).
    // We operate inside each <p> so a mid-string mention in a different
    // paragraph stays intact. After stripping the tail, also trim trailing
    // whitespace inside the <p> so empty newlines don't render as gaps.
    .replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, (_full, open, inner, close) => {
      const cleaned = stripLLMTails(inner).replace(/\s+$/u, '');
      return cleaned ? `${open}${cleaned}${close}` : '';
    })
    // Common cleanup after stripping: empty tags + trailing whitespace noise
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br/><br/>');
}
