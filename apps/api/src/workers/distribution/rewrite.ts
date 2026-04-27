import { callClaude } from '@ch/agents';

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

export async function rewriteForTwitter(item: DistributionItem): Promise<RewriteResult> {
  const prompt = `文章标题：${item.title}
分类：${item.category ?? '—'}
标签：${item.tags.slice(0, 5).join('、') || '—'}
摘要：${item.summary ?? '（无摘要）'}
文章链接：${item.published_url}

请把这篇文章改写成一条 X（Twitter）推文，结尾加上文章链接。`;

  const res = await callClaude({
    model: 'sonnet',
    system: [{ text: SYSTEM, cache: true }],
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 256,
    temperature: 0.7,
  });

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
