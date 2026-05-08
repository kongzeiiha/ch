/**
 * Derive memory rules from accumulated training examples (slow feedback loop).
 *
 * Flow:
 *   1. Fetch the last N training examples for a domain where agreement=false
 *      (human overrode the machine — highest-signal corrections).
 *   2. Format them as a compact diff list for the LLM.
 *   3. Ask the LLM to synthesize 3–8 concise directive rules that capture
 *      the recurring patterns.
 *   4. Upsert each generated rule into agent_memory_rules with origin='derived'.
 *   5. Mark examples as used_for_training=true so they aren't re-processed.
 *
 * Designed to run weekly (cron or on-demand via /admin/training-data/derive-rules).
 */

import { callClaude } from '@ch/agents';
import { query, execute } from '@ch/db';
import { createRule } from './memory-rules.js';

export interface DeriveResult {
  domain: 'compliance' | 'distribution';
  examplesRead: number;
  rulesCreated: number;
  rules: string[];
}

const MAX_EXAMPLES = 60;

// ─── Compliance derivation ───────────────────────────────────────────────────

const COMPLIANCE_DERIVE_SYSTEM = `你是一名合规策略分析师。你会收到一批「机器决策 vs 人工纠正」的对比记录，
任务是从中归纳出 3-8 条可操作的规则，指导合规审核 AI 在下次运行时减少人工介入。

格式要求：
- 仅输出 JSON 数组，每项是一条规则字符串，不超过 100 字
- 规则措辞：明确、指令式（例：「凡含 X 应打 Y 分」「若标题包含 Z 则……」）
- 不要写序号、不要解释、只输出 JSON 数组`;

function formatComplianceExamples(
  rows: Array<{ input_data: any; machine_output: any; human_label: any }>,
): string {
  return rows
    .map((r, i) => {
      const inp = r.input_data ?? {};
      const mac = r.machine_output ?? {};
      const hum = r.human_label ?? {};
      const machineScores = mac.scores ?? {};
      const topDim = Object.entries(machineScores).sort(([, a], [, b]) => Number(b) - Number(a))[0];
      return (
        `[${i + 1}] 标题:${String(inp.title ?? '').slice(0, 60)}\n` +
        `    分类:${inp.category ?? '—'}\n` +
        `    机器最高分:${topDim ? `${topDim[0]}=${topDim[1]}` : '全0'}\n` +
        `    人工决定:${hum.decision === 'approve' ? '放行' : '拒绝'}${hum.reason ? `（${hum.reason}）` : ''}`
      );
    })
    .join('\n\n');
}

// ─── Distribution derivation ─────────────────────────────────────────────────

const DISTRIBUTION_DERIVE_SYSTEM = `你是一名社交媒体编辑顾问。你会收到一批「AI 生成推文 vs 编辑修改后版本」的对比记录，
任务是从中归纳出 3-8 条可操作的写作规则，让 AI 下次生成的推文更贴近人工偏好。

格式要求：
- 仅输出 JSON 数组，每项是一条规则字符串，不超过 100 字
- 规则措辞：明确、指令式（例：「避免在推文中使用'…'省略号」「hashtag 优先用英文」）
- 不要写序号、不要解释、只输出 JSON 数组`;

function formatDistributionExamples(
  rows: Array<{ input_data: any; machine_output: any; human_label: any }>,
): string {
  return rows
    .map((r, i) => {
      const inp = r.input_data ?? {};
      const mac = r.machine_output ?? {};
      const hum = r.human_label ?? {};
      return (
        `[${i + 1}] 标题:${String(inp.title ?? '').slice(0, 60)}\n` +
        `    AI推文:${String(mac.copy ?? '').slice(0, 200)}\n` +
        `    编辑后:${String(hum.copy ?? '').slice(0, 200)}`
      );
    })
    .join('\n\n');
}

// ─── Core ────────────────────────────────────────────────────────────────────

export async function deriveRulesFromExamples(
  domain: 'compliance' | 'distribution',
): Promise<DeriveResult> {
  // Fetch high-signal examples not yet used for derivation
  const rows = await query<{ id: string; input_data: any; machine_output: any; human_label: any }>(
    `SELECT id, input_data, machine_output, human_label
     FROM training_examples
     WHERE source = $1 AND agreement = false AND used_for_training = false
     ORDER BY created_at DESC
     LIMIT $2`,
    [domain, MAX_EXAMPLES],
  );

  if (rows.length < 3) {
    return { domain, examplesRead: rows.length, rulesCreated: 0, rules: [] };
  }

  const systemPrompt = domain === 'compliance' ? COMPLIANCE_DERIVE_SYSTEM : DISTRIBUTION_DERIVE_SYSTEM;
  const examplesText =
    domain === 'compliance'
      ? formatComplianceExamples(rows)
      : formatDistributionExamples(rows);

  const userText =
    `以下是 ${rows.length} 条「机器决策 vs 人工纠正」记录：\n\n${examplesText}\n\n请归纳规则（JSON 数组）:`;

  const r = await callClaude({
    model: 'sonnet',
    system: systemPrompt,
    messages: [{ role: 'user', content: userText }],
    maxTokens: 1024,
    temperature: 0.3,
  });

  // Parse the JSON array from LLM response
  let derivedRules: string[] = [];
  try {
    const cleaned = r.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      derivedRules = parsed
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x: string) => x.trim().slice(0, 100))
        .slice(0, 8);
    }
  } catch {
    console.warn(`[derive-rules] JSON parse failed: ${r.text.slice(0, 300)}`);
    return { domain, examplesRead: rows.length, rulesCreated: 0, rules: [] };
  }

  if (derivedRules.length === 0) {
    return { domain, examplesRead: rows.length, rulesCreated: 0, rules: [] };
  }

  // Persist rules with origin='derived'
  for (const rule of derivedRules) {
    await createRule({
      domain,
      rule,
      origin: 'derived',
      notes: `自动归纳自 ${rows.length} 条训练样本 (${new Date().toISOString().slice(0, 10)})`,
      created_by: 'system:derive-rules',
    });
  }

  // Mark examples as consumed so they aren't re-processed next run
  const ids = rows.map((r) => r.id);
  await execute(
    `UPDATE training_examples SET used_for_training = true WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );

  console.info(
    `[derive-rules] domain=${domain} examples=${rows.length} → ${derivedRules.length} rules`,
  );

  return { domain, examplesRead: rows.length, rulesCreated: derivedRules.length, rules: derivedRules };
}
