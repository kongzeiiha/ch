import { callClaude } from '@ch/agents';
import { getActiveRules, buildRulesPromptSection, recordRuleHits } from '../../memory-rules.js';

export interface DistributionItem {
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  published_url: string;
}

export interface RewriteResult {
  copy: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  costUsd: number;
}

const SYSTEM = `你是一名专业的社交媒体编辑，擅长将文章改写为 X（Twitter）推文。

规则：
- 总长度 ≤ 280 字符（含链接占位 23 字符）
- 正文简洁有力，1-2 句话，突出核心价值
- 结尾带 2-3 个英文 hashtag（中文内容可用拼音或英文）
- 不要加 "【】" 标题格式，直接写正文
- 语气：专业但不刻板，可以有轻微情绪/感叹

输出格式：只输出推文正文，不要任何解释。`;

function rewriteByRules(item: DistributionItem): RewriteResult {
  // Rule-based fallback: trim title to fit, append top tags as hashtags, then link.
  // Used when DISTRIBUTION_SKIP_LLM=1 (smoke tests, no-credit envs).
  const linkLen = 23; // X t.co budget
  const tags = (item.tags ?? []).slice(0, 3).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');
  const tagsLen = tags ? tags.length + 1 : 0;
  const budget = 280 - linkLen - tagsLen - 1; // -1 for space before link
  const headline = item.title.length > budget ? `${item.title.slice(0, budget - 1)}…` : item.title;
  const copy = `${headline}${tags ? ' ' + tags : ''} ${item.published_url}`.trim();
  return {
    copy,
    model: 'rule:headline+tags',
    usage: { input_tokens: 0, output_tokens: 0 },
    costUsd: 0,
  };
}

export async function rewriteForTwitter(item: DistributionItem): Promise<RewriteResult> {
  if (process.env.DISTRIBUTION_SKIP_LLM === '1') return rewriteByRules(item);

  const prompt = `文章标题：${item.title}
分类：${item.category ?? '—'}
标签：${item.tags.slice(0, 5).join('、') || '—'}
摘要：${item.summary ?? '（无摘要）'}
文章链接：${item.published_url}

请把这篇文章改写成一条 X（Twitter）推文，结尾加上文章链接。`;

  // Inject any operator-curated rewrite rules from past edits. Same caching
  // pattern as compliance: BASE prompt cached, rules appended uncached.
  const rules = await getActiveRules('distribution', 'channel=twitter');
  const rulesText = buildRulesPromptSection(rules);
  const systemBlocks: { text: string; cache?: boolean }[] = [{ text: SYSTEM, cache: true }];
  if (rulesText) systemBlocks.push({ text: rulesText });

  const res = await callClaude({
    model: 'sonnet',
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 256,
    temperature: 0.7,
  });

  if (rules.length > 0) {
    void recordRuleHits(rules.map((r) => r.id));
  }

  return {
    copy: res.text.trim(),
    model: res.model,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens,
    },
    costUsd: res.costUsd,
  };
}
