import { callClaude, sanitizeForPrompt, type Model } from '@ch/agents';
import { getActiveRules, buildRulesPromptSection, recordRuleHits } from '../../memory-rules.js';

export const PROMPT_VERSION = 'v1';

export const DIMENSIONS = [
  '政治敏感',
  // '色情低俗',
  '暴力恐怖',
  '版权争议',
  '医疗夸大',
  '金融诱导',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface RiskScores {
  scores: Record<Dimension, number>;
  reasons: Partial<Record<Dimension, string>>;
}

const TOOL = {
  name: 'score_risk',
  description: '对文章在 6 个合规维度打分 0-3',
  input_schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: Object.fromEntries(
          DIMENSIONS.map((d) => [d, { type: 'integer' }]),
        ),
        required: [...DIMENSIONS],
      },
      reasons: {
        type: 'object',
      },
    },
    required: ['scores', 'reasons'],
  },
};

const SYSTEM = `你是中文内容合规审核员。对文章在下列 6 个维度分别打 0-3 分:

0 = 完全无风险
1 = 轻度相关,不影响发布
2 = 存在一定风险,建议人工复核
3 = 明显违规,应直接拒绝

维度说明:
- 政治敏感:涉及政治人物、敏感事件、颠覆性言论、民族宗教冲突
- 色情低俗:露骨性描述、擦边球、低俗猎奇
- 暴力恐怖:暴力行为教唆、恐怖袭击细节、血腥描写
- 版权争议:直接搬运、未去水印、明显未授权段落
- 医疗夸大:无证医疗建议、包治百病、虚假疗效
- 金融诱导:非法集资、保本保收益承诺、荐股荐币

规则:
- 只就本文内容本身打分,不推测作者动机,不基于作者身份
- reasons 只在评分 ≥ 2 的维度给出一句简短理由(≤50 字)
- 如果文章明显正常,全部打 0`;

const MAX_CONTENT = 1_800;

export async function scoreCompliance(
  input: { title: string | null; content: string; category?: string | null },
  opts: { model?: Model } = {},
) {
  const userText = [
    input.title ? `标题:${sanitizeForPrompt(input.title, 200)}` : null,
    `正文:\n${sanitizeForPrompt(input.content, MAX_CONTENT)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Pull active feedback-derived rules and append them to the system prompt.
  // Cache stays effective for the BASE prompt; only the rules section varies.
  // We pass them as a separate (uncached) block so cache hit rate stays high.
  const scope = input.category ? `category=${input.category}` : null;
  const rules = await getActiveRules('compliance', scope);
  const rulesText = buildRulesPromptSection(rules);

  const systemBlocks: { text: string; cache?: boolean }[] = [{ text: SYSTEM, cache: true }];
  if (rulesText) systemBlocks.push({ text: rulesText });

  const r = await callClaude({
    model: opts.model ?? 'sonnet',
    maxTokens: 512,
    temperature: 0,
    system: systemBlocks,
    tools: [TOOL],
    toolChoice: { type: 'tool', name: 'score_risk' },
    messages: [{ role: 'user', content: userText }],
  });

  if (!r.toolUse || r.toolUse.name !== 'score_risk') {
    throw new Error(`compliance: no tool call (text="${r.text.slice(0, 200)}")`);
  }

  // Bump rule hit counters fire-and-forget. Do this only after a successful
  // call so failed attempts don't pollute the rule's effectiveness signal.
  if (rules.length > 0) {
    void recordRuleHits(rules.map((r) => r.id));
  }

  return {
    result: r.toolUse.input as RiskScores,
    model: r.model,
    usage: r.usage,
    cost: r.costUsd,
    rulesApplied: rules.length,
  };
}
