import { callClaude, sanitizeForPrompt, type Model } from '@ch/agents';
import { CATEGORIES, TAXONOMY_PROMPT, type Category } from './taxonomy.js';

export const PROMPT_VERSION = 'v1';

export interface Classified {
  category: Category;
  tags: string[];
  keywords: string[];
}

// ── Rule-based fallback (no LLM) ──────────────────────────────────────────
// Maps each predefined category to representative keyword patterns. Articles
// are scored by total matches; the top-scoring category wins. If nothing
// matches, the article falls back to '其他'.
//
// Order in CATEGORIES (taxonomy.ts) decides tie-breaks — strict `>` so the
// FIRST category at the same score wins. Put specific buckets (番号 / 美乳)
// before broad ones (探花 / 调教) so the broad rules don't poach.
//
// Each pattern is a separate /.../, scored by total .match() length so a
// title with multiple hits across one big regex still counts as one hit.
// Use multiple regexes if a category has distinct concept clusters.
const CATEGORY_KEYWORDS: Record<Category, RegExp[]> = {
  'AI': [
    /\b(AI|GPT|LLM|ChatGPT|Claude|Gemini|OpenAI|Anthropic)\b/i,
    /人工智能|机器学习|深度学习|神经网络|大模型|大语言模型|生成式/,
  ],
  '文化艺术': [
    /艺术|博物馆|画展|绘画|雕塑|摄影|电影|戏剧|音乐|文学|诗歌|考古|古代|历史|遗址|文物|壁画|书法/,
    /\b(museum|gallery)\b/i,
  ],

  // ── 高特征性:番号(AV 编号),最具识别度,优先级最高 ──
  // 典型形态: MIAB-358 / MVSD-542 / JUL-1234 / SSIS-001
  // 命名实体匹配(2-6 个大写字母 + 短横/下划线 + 2-4 位数字)
  '番号': [
    /\b(MIAB|MVSD|IPX|SSIS|MIDV|JUL|JUFE|ABF|ABW|FSDSS|MEYD|JUQ|SONE|SSNI|ADN|VEC|PRED|MIAA|HUNTA|HUNTC|NACR|FERA|STARS|MIDE|PPPD|SHKD|MIDD|RBD|EBOD|PPPE|MIDA|MIDA|JUNY|JUFD)-\d{2,5}\b/i,
    /番号\s*[:：]?\s*[A-Z]{2,6}[-_]?\d{2,5}/i,
    /\b[A-Z]{2,6}-\d{3,5}\b/, // 通用 AV 编号兜底
  ],

  // ── 身体部位 + 类型 ──
  '美乳': [/美乳|爆乳|奶子|大胸|妹胸|乳房|完美胸|胸器|G\s*奶|H\s*奶/],
  '巨乳': [/巨乳|乳交|超巨/, /巨乳|乳交/],
  '美腿': [/美腿|长腿|腿控|腿模|大长腿|玉腿|肉腿/],
  '美臀': [/美臀|臀控|翘臀|包臀|看臀|肥臀|蜜桃臀|蜜臀|后入|翘起.{0,4}臀/],
  '丝袜': [
    /丝袜|肉丝|连裤袜|裤袜|肉色丝袜|透明丝袜|打底裤|蕾丝丝袜|吊带袜|高筒丝袜|过膝袜/,
    /丝袜/,
  ],
  '黑丝': [/黑丝|黑色丝袜/],

  // ── 行为 / 体位 ──
  '潮吹': [/潮吹|喷水|喷射|尿失禁/, /潮吹|喷水/],
  '颜射': [/颜射|面射|颜面射精|颜面/, /颜射/],
  '内射': [/内射|中出|内出/, /内射|中出/],
  '口射': [/口射|口爆|口腔|含蓄/, /口射|口爆/],

  // ── 主题 / 角色 ──
  '制服': [
    /制服|JK|学生妹|cosplay|护士|空姐|女仆|教师|工口教师|空姐制服/i,
    /制服|JK/i,
  ],
  '露出': [/露出|户外|公共|街拍|暴露|公车|电车|车震/, /露出|户外/],
  '熟女': [/熟女|人妻|妈妈|阿姨|少妇|姨妈|继母|妻子|岳母|寡妇/, /熟女|人妻/],
  '萝莉': [/萝莉|loli/i, /萝莉/], // 谨慎:仅触发明确的萝莉关键词,不含"妹纸"等模糊表达
  '反差': [/反差|清纯.{0,8}却|外表.{0,12}内心|乖巧.{0,8}却/, /反差/],
  '多人': [
    /多人|多\s*P|3\s*P|4\s*P|5\s*P|众交|群交|多人运动|3人|4人|多个/i,
    /3\s*P|4\s*P|多人/i,
  ],

  // ── 行为 / 场景 ──
  // 足控:fetish 类目,搜得到的人会精准搜。覆盖足/腿/丝足/玉足/腿法等
  '足控': [/足穴|玉足|丝足|足交|脚交|脚臭|脚法|腿法|脚趾|舔脚|嗅足/, /足控|脚控/],
  // 校园:学生/idol/校花/班花/学姐/学妹 — 通常是剧情但更具体
  '校园': [/校花|班花|学姐|学妹|学校|同学|教室|宿舍|idol|偶像|经纪公司|高中|大学/i, /校园|校花|班花/],
  // 投稿:UGC 类,大量带"投稿/女友分享/投稿女友/分享女友"标签的内容
  '投稿': [
    /投稿|女友分享|分享女友|投稿女友|别人的女友|网友投稿|读者投稿/,
    /\b(投稿|女友分享)\b/,
  ],
  // 自拍: 把之前坏掉的 `\b\s\S]{0,60}\d+\s*P\b` 修成正确的 [\s\S]{0,60}\d+\s*P\b
  '自拍': [
    /自拍|私拍|嫩模|网红|私房|大尺度|低胸|美胸|内衣|睡袍|蕾丝/,
    /[\s\S]{0,60}\d+\s*P\b/,
    /自拍/,
  ],
  '偷拍': [/偷拍|偷窥|针孔|监控|偷录|高清偷拍/, /偷拍|偷窥/],
  '探花': [/探花|约炮|宾馆|酒店|嫖娼|外围/, /探花/],
  '自慰': [/自慰|手淫|抠/, /自慰/],
  // 移除空 alternation bug 还原过的 `露点||走光`,改成更严格的 NSFW 关键词
  'SM': [/SM|束缚|捆绑|奴隶|主人|滴蜡|皮鞭|奴隷|绳缚|玩具|跳蛋|按摩棒|情趣/, /\bSM\b/],
  '动漫': [/动漫|二次元|动画|hentai|漫画|3D动画/i, /动漫|二次元/],
  '剧情': [
    /剧情|故事|情节|纯爱|偷情|背叛|出轨|强迫|拒绝|关键词《[^》]+》/,
    // 家族/角色 NTR 类故事典型词:嫂子/妹妹/姐姐/义母/继母/婆婆/公公/堂姐/表姐
    /嫂子|义母|继母|表姐|表妹|堂姐|堂妹|妹妹|姐姐|公媳|婆婆|岳母|阿姨|风韵犹存|催眠|穿越|改造/,
    /剧情/,
  ],
  '调教': [/调教|淫荡|无圣光|无码|福利图|擦边|训练/, /调教/],
  '网曝门': [/网曝门|网曝|曝光|流出|外泄|内幕/, /网曝门|网曝/],

  '其他': [],
};

/**
 * Strip URLs and HTML attribute fragments before regex matching.
 *
 * Without this, raw_item.text containing "来源:https://xx.knit.bid/app/..."
 * makes the path segment "/app/" match `\bApp\b` and incorrectly classifies
 * every gallery item as "互联网产品". Same for any keyword that happens to
 * appear in a URL path: "android" / "ios" / "saas" / "ui" etc.
 *
 * Also strips bare-host URLs commonly seen in tweets (`t.co/abc`, `bit.ly/x`)
 * — these don't match the http/www patterns above but still leak path
 * fragments into downstream tokenization.
 */
function stripUrls(s: string): string {
  return s
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/\b(?:t\.co|bit\.ly|goo\.gl|tinyurl\.com|ow\.ly|buff\.ly)\/[^\s]*/gi, ' ');
}

// Tokens that look like words but are URL or markup debris. Hit by the
// title splitter when classifyByRules tokenizes things like "https://t.co/xxx"
// into ["https", "t", "co", "xxx"]. Lowercased — comparison is case-insensitive.
const TOKEN_DENYLIST = new Set([
  'http', 'https', 'www',
  't', 'co', 'cn', 'com', 'org', 'net', 'io', 'app', 'html', 'htm',
  'amp', 'utm', 'src', 'ref',
]);

function isClean(token: string): boolean {
  const t = token.trim();
  if (t.length < 2 || t.length > 32) return false;
  if (TOKEN_DENYLIST.has(t.toLowerCase())) return false;
  // Anything containing % is almost certainly a URL-encoded fragment that
  // slipped past stripUrls (e.g. "%E4%BA" from a raw-encoded link).
  if (t.includes('%')) return false;
  // Pure alphanumeric tokens of length ≤3 are usually noise (status codes,
  // tweet-id prefixes, "9q" path slugs). Keep CJK / longer tokens.
  if (/^[a-z0-9]{1,3}$/i.test(t)) return false;
  return true;
}

/**
 * Score-based rule classifier. Zero LLM calls. Returns the best-matched
 * category plus a de-duplicated list of the keyword terms that actually hit.
 */
export function classifyByRules(input: { title: string | null; content: string }): Classified {
  const cleanTitle = stripUrls(input.title ?? '');
  const text = stripUrls(`${input.title ?? ''}\n${input.content ?? ''}`);

  let bestCategory: Category = '其他';
  let bestScore = 0;
  const hitsByCategory: Record<string, Set<string>> = {};

  for (const cat of CATEGORIES) {
    if (cat === '其他') continue;
    const patterns = CATEGORY_KEYWORDS[cat];
    let score = 0;
    const hitTerms = new Set<string>();
    for (const p of patterns) {
      const matches = text.match(p);
      if (matches) {
        score += matches.length;
        for (const m of matches) hitTerms.add(m.toLowerCase());
      }
    }
    hitsByCategory[cat] = hitTerms;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  // Build tags/keywords from the hit terms of the winning category (up to 8),
  // padded with title-derived nouns if too few. Run the title through the
  // same URL stripper so tweet-style "https://t.co/xxx" doesn't tokenize into
  // ["https", "t", "co", "xxx"].
  const primary = Array.from(hitsByCategory[bestCategory] ?? []).filter(isClean).slice(0, 8);
  const titleWords = cleanTitle
    .split(/[\s,，。.:：·\-—、/|?&=#]+/)
    .filter(isClean);
  const tags = Array.from(new Set([...primary, ...titleWords])).slice(0, 8);
  const keywords = tags.slice(0, 6);

  return {
    category: bestCategory,
    tags: tags.length ? tags : ['未分类'],
    keywords: keywords.length ? keywords : ['未分类'],
  };
}

const TOOL = {
  name: 'categorize',
  description: '输出文章分类、标签、关键词',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')}` },
      tags: { type: 'array', items: { type: 'string' } },
      keywords: { type: 'array', items: { type: 'string' } },
    },
    required: ['category', 'tags', 'keywords'],
  },
};

const MAX_CONTENT = 1_200;

export async function classify(
  input: { title: string | null; content: string },
  opts: { model?: Model } = {},
) {
  const content = sanitizeForPrompt(input.content, MAX_CONTENT);
  const userText = [
    input.title ? `标题:${sanitizeForPrompt(input.title, 200)}` : null,
    `正文:\n${content}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await callClaude({
    model: opts.model ?? 'haiku',
    maxTokens: 512,
    temperature: 0,
    // The taxonomy prompt is stable across thousands of calls — cache it.
    system: [{ text: TAXONOMY_PROMPT, cache: true }],
    tools: [TOOL],
    toolChoice: { type: 'tool', name: 'categorize' },
    messages: [{ role: 'user', content: userText }],
  });

  if (!r.toolUse || r.toolUse.name !== 'categorize') {
    throw new Error(`categorize: model returned no tool call (text="${r.text.slice(0, 200)}")`);
  }

  const data = r.toolUse.input as Classified;
  if (!CATEGORIES.includes(data.category)) {
    throw new Error(`categorize: invalid category "${data.category}"`);
  }
  return {
    result: data,
    model: r.model,
    usage: r.usage,
    cost: r.costUsd,
    latencyMs: r.latencyMs,
  };
}
