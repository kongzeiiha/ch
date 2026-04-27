import { callClaude, type Model } from '@ch/agents';

export interface TitleOutput {
  candidates: string[];
  best_index: number;
  summary: string;
}

// ── Rule-based fallback (no LLM) ──────────────────────────────────────────
// Uses the original RSS / HTML title verbatim as the single candidate, and
// grabs the opening ~150 chars of the cleaned article as the summary. Zero
// LLM calls. Sufficient for sites whose titles are already decent.
export function generateTitleByRules(input: {
  originalTitle: string | null;
  content: string;
}): TitleOutput {
  const title = (input.originalTitle ?? '').trim() || '未命名';
  const text = input.content.replace(/\s+/g, ' ').trim();
  const summary = text.slice(0, 180) || title;
  return {
    candidates: [title],
    best_index: 0,
    summary,
  };
}

const TOOL = {
  name: 'propose_titles',
  description: '给出 3 个标题候选,挑选最佳,并写一段摘要',
  input_schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: { type: 'string' },
      },
      best_index: { type: 'integer' },
      summary: { type: 'string' },
    },
    required: ['candidates', 'best_index', 'summary'],
  },
};

const SYSTEM = `你是 SEO 编辑。根据给定文章正文与分类/标签,产出 3 个不同风格的中文标题候选,并从中挑选最适合推荐给中国用户的那个,再写一段 120-180 字的摘要。

规则:
- 标题 ≤ 30 字,信息密度高,不要使用点击诱饵式感叹号连用;允许数字和方括号前缀。
- 3 个候选风格要有区分(例如:事实型 / 观点型 / 结果型)。
- 摘要只描述文章核心,不要加引导语"本文"。
- 如果原文是英文,翻译后改写,不要直译。
- 摘要与标题均用简体中文。`;

const MAX_CONTENT = 1_500;

export async function generateTitle(
  input: {
    originalTitle: string | null;
    category: string | null;
    tags: string[];
    content: string;
  },
  opts: { model?: Model } = {},
): Promise<{ result: TitleOutput; model: string; usage: any; cost: number; latencyMs: number }> {
  const userText = [
    input.originalTitle ? `原标题:${input.originalTitle}` : null,
    input.category ? `分类:${input.category}` : null,
    input.tags.length ? `标签:${input.tags.join(' / ')}` : null,
    `正文:\n${input.content.slice(0, MAX_CONTENT)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await callClaude({
    model: opts.model ?? 'sonnet',
    maxTokens: 1024,
    temperature: 0.5,
    system: [{ text: SYSTEM, cache: true }],
    tools: [TOOL],
    toolChoice: { type: 'tool', name: 'propose_titles' },
    messages: [{ role: 'user', content: userText }],
  });

  if (!r.toolUse || r.toolUse.name !== 'propose_titles') {
    throw new Error(`title: no tool call (text="${r.text.slice(0, 200)}")`);
  }
  const out = r.toolUse.input as TitleOutput;
  if (!Array.isArray(out.candidates) || out.candidates.length !== 3) {
    throw new Error('title: expected 3 candidates');
  }
  if (out.best_index < 0 || out.best_index > 2) {
    throw new Error('title: best_index out of range');
  }

  return {
    result: out,
    model: r.model,
    usage: r.usage,
    cost: r.costUsd,
    latencyMs: r.latencyMs,
  };
}
