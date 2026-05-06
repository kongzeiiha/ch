/**
 * Agent memory rules — fast feedback loop.
 *
 * Operators (or, eventually, an LLM digesting training_examples) author short
 * directive-style rules. At runtime, agents fetch the active rules for their
 * domain and append them to the system prompt so the next inference reflects
 * the human guidance immediately — no fine-tune cycle needed.
 *
 * Cap: at most MAX_RULES_PER_DOMAIN are injected per call. We pick the most
 * recent active rules (by updated_at). Hit_count is bumped per call to give
 * us "regular hit but never moves the needle" candidates for pruning.
 */
import { randomUUID } from 'node:crypto';
import { query, execute } from '@ch/db';

export const MAX_RULES_PER_DOMAIN = 20;

export interface MemoryRule {
  id: string;
  domain: string;
  scope: string | null;
  rule: string;
  origin: 'human' | 'derived';
  status: 'active' | 'paused' | 'deprecated';
  hit_count: number;
  last_used_at: string | null;
  created_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listRules(opts: { domain?: string; status?: string } = {}): Promise<MemoryRule[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.domain) { params.push(opts.domain); where.push(`domain = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return query<MemoryRule>(
    `SELECT id, domain, scope, rule, origin, status, hit_count,
            last_used_at,
            created_by, notes,
            created_at, updated_at
     FROM agent_memory_rules ${whereSql}
     ORDER BY status ASC, updated_at DESC`,
    params,
  );
}

/**
 * Fetch active rules for a domain, optionally narrowed by scope. Used at
 * inference time to build the system prompt. Capped to MAX_RULES_PER_DOMAIN.
 *
 * `scope` is a free-form key=value tag. A rule with scope=NULL applies to all;
 * a rule with scope='category=AI' only applies when the caller passes that
 * exact scope. We deliberately keep the matching simple — it's not a query
 * language. If you need richer matching, structure the scope into rule_type.
 */
export async function getActiveRules(domain: string, scope?: string | null): Promise<MemoryRule[]> {
  return query<MemoryRule>(
    `SELECT id, domain, scope, rule, origin, status, hit_count,
            last_used_at,
            created_by, notes,
            created_at, updated_at
     FROM agent_memory_rules
     WHERE domain = $1
       AND status = 'active'
       AND (scope IS NULL OR scope = $2)
     ORDER BY updated_at DESC
     LIMIT $3`,
    [domain, scope ?? null, MAX_RULES_PER_DOMAIN],
  );
}

/**
 * Build a prompt fragment that lists the rules. Empty string when there are
 * no rules — caller can safely concatenate unconditionally.
 */
export function buildRulesPromptSection(rules: MemoryRule[]): string {
  if (rules.length === 0) return '';
  // Group by origin so the model can weigh "human-authored" higher than
  // automatically-derived ones if needed (we just label them; we don't
  // duplicate ordering logic in the prompt).
  const numbered = rules.map((r, i) => {
    const tag = r.origin === 'human' ? '人工' : '反馈归纳';
    return `${i + 1}. [${tag}] ${r.rule}`;
  }).join('\n');
  return `\n\n## 历史人工反馈沉淀的规则（违反将拉高对应风险评分 / 修改输出）\n${numbered}`;
}

/**
 * Bump hit_count + last_used_at on the rules that were just shown. Fire-and-
 * forget so a slow UPDATE doesn't add to inference latency. Called by agents
 * after a successful LLM call to attribute usage.
 */
export async function recordRuleHits(ruleIds: string[]): Promise<void> {
  if (ruleIds.length === 0) return;
  try {
    await query(
      `UPDATE agent_memory_rules
         SET hit_count = hit_count + 1, last_used_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ruleIds],
    );
  } catch (e: any) {
    // Non-fatal: counters are advisory.
    console.warn(`[memory-rules] hit increment failed: ${e?.message ?? e}`);
  }
}

// ─── CRUD used by admin endpoints ─────────────────────────────────────────────

export interface CreateRuleInput {
  domain: string;
  scope?: string | null;
  rule: string;
  origin?: 'human' | 'derived';
  derived_from?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

export async function createRule(input: CreateRuleInput): Promise<MemoryRule> {
  const id = randomUUID();
  await query(
    `INSERT INTO agent_memory_rules
       (id, domain, scope, rule, origin, derived_from, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.domain,
      input.scope ?? null,
      input.rule.trim(),
      input.origin ?? 'human',
      input.derived_from ?? null,
      input.notes ?? null,
      input.created_by ?? null,
    ],
  );
  const rows = await query<MemoryRule>(
    `SELECT id, domain, scope, rule, origin, status, hit_count,
            last_used_at, created_by, notes, created_at, updated_at
     FROM agent_memory_rules WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export interface UpdateRuleInput {
  scope?: string | null;
  rule?: string;
  status?: 'active' | 'paused' | 'deprecated';
  notes?: string | null;
}

export async function updateRule(id: string, input: UpdateRuleInput): Promise<MemoryRule | null> {
  const r = await execute(
    `UPDATE agent_memory_rules
       SET scope  = COALESCE($2, scope),
           rule   = COALESCE($3, rule),
           status = COALESCE($4, status),
           notes  = COALESCE($5, notes)
     WHERE id = $1`,
    [id, input.scope ?? null, input.rule ?? null, input.status ?? null, input.notes ?? null],
  );
  if (r.affectedRows === 0) return null;
  const rows = await query<MemoryRule>(
    `SELECT id, domain, scope, rule, origin, status, hit_count,
            last_used_at, created_by, notes, created_at, updated_at
     FROM agent_memory_rules WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteRule(id: string): Promise<boolean> {
  const r = await execute(
    `DELETE FROM agent_memory_rules WHERE id = $1`,
    [id],
  );
  return r.affectedRows > 0;
}
