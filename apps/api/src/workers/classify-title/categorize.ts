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
const CATEGORY_KEYWORDS: Record<Category, RegExp[]> = {
  'AI': [/\b(AI|GPT|LLM|ChatGPT|Claude|Gemini|OpenAI|Anthropic)\b/i, /人工智能|机器学习|深度学习|神经网络|大模型|大语言模型|生成式/],
  // '硬件': [/芯片|半导体|处理器|主板|显卡|内存|固态|硬盘|传感器|电池/, /\b(CPU|GPU|NPU|SoC|RAM|SSD|HDD)\b/i, /iPhone|iPad|MacBook|安卓/],
  // '软件工程': [/编程|代码|开源|仓库|框架|算法|数据结构|重构|bug|调试/, /\b(Git|GitHub|React|Vue|Node|Python|Rust|TypeScript|Docker|Kubernetes|API)\b/i],
  // '网络安全': [/漏洞|黑客|木马|勒索|钓鱼|零信任|DDoS|渗透|溯源|加密/, /\b(CVE|XSS|SQL注入|2FA|TLS|SSL)\b/i],
  // '互联网产品': [/产品|用户体验|界面|交互|增长|留存|用户画像|运营|拉新|转化/, /\b(UX|UI|App|iOS|Android|SaaS)\b/i],
  // '创业与投资': [/创业|融资|风投|天使轮|种子轮|估值|IPO|上市|退出|孵化/, /\b(VC|LP|GP|angel|seed)\b/i],
  // '金融市场': [/股市|股票|股价|财报|利率|美联储|央行|债券|汇率|期货|大宗/, /\b(Fed|SEC|ECB|S&P)\b/i],
  // '加密货币': [/比特币|以太坊|区块链|加密|稳定币|链上|钱包|挖矿|NFT|DAO/, /\b(BTC|ETH|Crypto|DeFi|Web3|L2)\b/i],
  // '物理与天文': [/物理|量子|宇宙|星系|黑洞|行星|恒星|引力|粒子|相对论|天文/, /\b(NASA|SpaceX|JWST|LIGO)\b/i],
  // '生命科学': [/基因|细胞|蛋白质|酶|病毒|细菌|抗体|疫苗|生物学|进化|遗传|临床/, /\b(DNA|RNA|CRISPR|mRNA)\b/i],
  // '气候与环境': [/气候|全球变暖|碳排放|温室气体|极端天气|污染|生态|可持续|光伏|风电|新能源|冰川/, /\b(IPCC|COP)\b/i],
  // '政治与政策': [/政府|政策|法规|立法|选举|国会|总统|首相|外交|制裁|条约|战争|军事/, /\b(UN|NATO|G7|EU)\b/i],
  // '社会新闻': [/社会|抗议|示威|案件|警方|凶杀|枪击|事故|灾害|救援|罢工/, /\b(BLM)\b/i],
  '文化艺术': [/艺术|博物馆|画展|绘画|雕塑|摄影|电影|戏剧|音乐|文学|诗歌|考古|古代|历史|遗址|文物|壁画|书法/, /\b(museum|gallery)\b/i],
  // '生活方式': [/旅行|旅游|美食|烹饪|健身|运动|时尚|穿搭|购物|育儿|家居|宠物|饮食/, /风景|风光/],
  '探花': [/探花|美乳|美腿|美臀|舔阴|运动|时尚|穿搭|购物|育儿|家居|宠物|饮食/, /探花/],
  '丝袜': [/丝袜|袜子|袜|长筒袜|短筒袜|连裤袜|裤袜|黑丝袜|肉色丝袜|透明丝袜|打底裤|蕾丝丝袜|吊带袜|高筒丝袜|过膝袜/, /丝袜|美腿/],
  '偷拍': [/私拍|偷拍/, /私拍|偷拍/],
  '自拍': [/自拍|低胸|美胸|美腿|大尺度|嫩模|蕾丝|睡袍|内衣|丝袜/,/\b\s\S]{0,60}\d+\s*P\b/, /自拍/],
  '调教': [/调教|淫荡|裸体|露点||走光|无圣光|无码|福利图|擦边/, /调教/],
  '熟女': [/熟女/, /熟女/],
  '自慰': [/自慰/, /自慰/],
  '动漫': [/动漫/, /动漫/],
  '萝莉': [/萝莉/, /萝莉/],
  'SM': [/SM/, /SM/],
  '剧情': [/剧情/, /剧情/],
  '网曝门': [/网曝门/, /网曝门|网曝/],
  '其他': [],
};

/**
 * Strip URLs and HTML attribute fragments before regex matching.
 *
 * Without this, raw_item.text containing "来源:https://xx.knit.bid/app/..."
 * makes the path segment "/app/" match `\bApp\b` and incorrectly classifies
 * every gallery item as "互联网产品". Same for any keyword that happens to
 * appear in a URL path: "android" / "ios" / "saas" / "ui" etc.
 */
function stripUrls(s: string): string {
  return s
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ');
}

/**
 * Score-based rule classifier. Zero LLM calls. Returns the best-matched
 * category plus a de-duplicated list of the keyword terms that actually hit.
 */
export function classifyByRules(input: { title: string | null; content: string }): Classified {
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
  // padded with title-derived nouns if too few.
  const primary = Array.from(hitsByCategory[bestCategory] ?? []).slice(0, 8);
  const titleWords = (input.title ?? '')
    .split(/[\s,，。.:：·\-—、/|]+/)
    .filter((w) => w.length >= 2 && w.length <= 8);
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
