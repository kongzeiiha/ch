/**
 * Training-data harvest pipeline.
 *
 * Mines two op-log signals into the `training_examples` table:
 *   1. compliance.approve / compliance.reject  — human override of REVIEW state
 *   2. distribution.edit-copy                  — human edited the LLM-generated tweet
 *
 * Idempotent: each op_log row is converted at most once (UNIQUE constraint on
 * training_examples.op_log_id). Run as often as you like.
 *
 * Export to SFT JSONL via `exportJsonl(source)`:
 *   - format follows the OpenAI/Groq fine-tuning convention:
 *     {"messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
 *   - one example per line
 */
import { randomUUID } from 'node:crypto';
import { query } from '@ch/db';

export interface HarvestStats {
  source: 'compliance' | 'distribution';
  scanned: number;
  inserted: number;
  skippedNoMachineRun: number;
  skippedNoItem: number;
}

interface ComplianceLogRow {
  op_id: string;
  operator: string;
  occurred_at: string;
  operation: string;
  item_id: string;
  payload: { decision?: 'approve' | 'reject'; reason?: string | null };
  // From items
  i_title: string | null;
  i_content: string | null;
  i_category: string | null;
  i_summary: string | null;
  // From the latest 'compliance' agent_run for this item
  ar_output: any;
  ar_started_at: string | null;
}

/**
 * Compliance feedback → training examples.
 *
 * Joins op_logs (the human decision) with the latest successful 'compliance'
 * agent_runs row (the machine decision the human was reviewing). When the
 * human acted on a REVIEW item, we record:
 *   - input_data:    {title, content_excerpt, category}
 *   - machine_output: the LLM's risk scores + reasons + blacklist hits
 *   - human_label:    {decision, reason, corrected_max_score}
 *
 * agreement is always false here — by definition the operator only reviews
 * when the machine asked for help (REVIEW state).
 */
export async function harvestComplianceFeedback(): Promise<HarvestStats> {
  const stats: HarvestStats = { source: 'compliance', scanned: 0, inserted: 0, skippedNoMachineRun: 0, skippedNoItem: 0 };

  // Find compliance op-logs that haven't been ingested yet.
  // LEFT JOIN trick on training_examples.op_log_id is faster than NOT EXISTS for our volumes.
  const rows = await query<ComplianceLogRow>(
    `SELECT
       ol.id           AS op_id,
       ol.operator     AS operator,
       ol.occurred_at  AS occurred_at,
       ol.operation    AS operation,
       ol.target_id    AS item_id,
       ol.payload      AS payload,
       i.title         AS i_title,
       i.content       AS i_content,
       i.category      AS i_category,
       i.summary       AS i_summary,
       (SELECT output FROM agent_runs
          WHERE agent='compliance' AND item_id = ol.target_id AND status='success'
          ORDER BY started_at DESC LIMIT 1) AS ar_output,
       (SELECT started_at FROM agent_runs
          WHERE agent='compliance' AND item_id = ol.target_id AND status='success'
          ORDER BY started_at DESC LIMIT 1) AS ar_started_at
     FROM operation_logs ol
     LEFT JOIN training_examples te ON te.op_log_id = ol.id
     LEFT JOIN items i ON i.id = ol.target_id
     WHERE ol.operation IN ('compliance.approve', 'compliance.reject')
       AND ol.target_type = 'item'
       AND te.id IS NULL
     ORDER BY ol.occurred_at ASC`,
  );

  stats.scanned = rows.length;

  for (const r of rows) {
    if (!r.i_title && !r.i_content) {
      // Item was deleted or never had content — can't form a useful sample.
      stats.skippedNoItem++;
      continue;
    }
    if (!r.ar_output) {
      // No machine compliance run found. Could be force-published or hand-loaded data.
      stats.skippedNoMachineRun++;
      continue;
    }

    const decision = r.payload?.decision ?? (r.operation === 'compliance.approve' ? 'approve' : 'reject');
    const reason = r.payload?.reason ?? null;

    const inputData = {
      title:   r.i_title,
      summary: r.i_summary,
      // Cap content length so the table doesn't bloat. Full content is still in items.
      content_excerpt: r.i_content ? r.i_content.slice(0, 1800) : null,
      category: r.i_category,
    };

    const humanLabel = {
      decision,
      reason,
      // Corrected max score: approve → 0 (no-risk), reject → 3 (auto-fail).
      // Trains the model to be more decisive on items it currently sends to REVIEW.
      corrected_max_score: decision === 'approve' ? 0 : 3,
    };

    await query(
      // INSERT IGNORE drops dup-key violations on the unique index over op_log_id.
      `INSERT IGNORE INTO training_examples
         (id, source, item_id, input_data, machine_output, human_label, agreement, op_log_id)
       VALUES ($1, 'compliance', $2, $3, $4, $5, false, $6)`,
      [
        randomUUID(),
        r.item_id,
        JSON.stringify(inputData),
        JSON.stringify(r.ar_output),
        JSON.stringify(humanLabel),
        r.op_id,
      ],
    );
    stats.inserted++;
  }

  return stats;
}

interface DistributionLogRow {
  op_id: string;
  operator: string;
  occurred_at: string;
  task_id: string;
  payload: { before?: string; after?: string; itemId?: string; channel?: string };
  i_id: string | null;
  i_title: string | null;
  i_summary: string | null;
  i_category: string | null;
  i_tags: string[] | null;
  i_published_url: string | null;
}

/**
 * Distribution copy edits → training examples.
 *
 * Every distribution.edit-copy op-log has payload.before (machine) and
 * payload.after (human). High-signal: the operator literally rewrote the
 * generated tweet. Used directly as (input → corrected output) pair.
 */
export async function harvestDistributionFeedback(): Promise<HarvestStats> {
  const stats: HarvestStats = { source: 'distribution', scanned: 0, inserted: 0, skippedNoMachineRun: 0, skippedNoItem: 0 };

  const rows = await query<DistributionLogRow>(
    `SELECT
       ol.id          AS op_id,
       ol.operator    AS operator,
       ol.occurred_at AS occurred_at,
       ol.target_id   AS task_id,
       ol.payload     AS payload,
       i.id           AS i_id,
       i.title        AS i_title,
       i.summary      AS i_summary,
       i.category     AS i_category,
       i.tags         AS i_tags,
       i.published_url AS i_published_url
     FROM operation_logs ol
     LEFT JOIN training_examples te ON te.op_log_id = ol.id
     LEFT JOIN distribution_tasks dt ON dt.id = ol.target_id
     LEFT JOIN items i ON i.id = dt.item_id
     WHERE ol.operation = 'distribution.edit-copy'
       AND ol.target_type = 'distribution_task'
       AND te.id IS NULL
     ORDER BY ol.occurred_at ASC`,
  );

  stats.scanned = rows.length;

  for (const r of rows) {
    const before = r.payload?.before;
    const after = r.payload?.after;
    if (typeof before !== 'string' || typeof after !== 'string' || before === after) {
      // No meaningful diff (or malformed payload) — skip.
      stats.skippedNoMachineRun++;
      continue;
    }
    if (!r.i_id || !r.i_title) {
      stats.skippedNoItem++;
      continue;
    }

    const inputData = {
      title:         r.i_title,
      summary:       r.i_summary,
      category:      r.i_category,
      tags:          r.i_tags ?? [],
      published_url: r.i_published_url,
      channel:       r.payload?.channel ?? 'twitter',
    };

    const humanLabel = {
      copy: after,
      edit_distance: levenshteinSmall(before, after),
    };

    await query(
      `INSERT IGNORE INTO training_examples
         (id, source, item_id, task_id, input_data, machine_output, human_label, agreement, op_log_id)
       VALUES ($1, 'distribution', $2, $3, $4, $5, $6, false, $7)`,
      [
        randomUUID(),
        r.i_id,
        r.task_id,
        JSON.stringify(inputData),
        JSON.stringify({ copy: before }),
        JSON.stringify(humanLabel),
        r.op_id,
      ],
    );
    stats.inserted++;
  }

  return stats;
}

// Cheap Levenshtein for edit-distance metric. Capped to avoid n×m blow-up on
// very long copy (>2000 chars). Used for analytics only — not for correctness.
function levenshteinSmall(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length > 2000 || b.length > 2000) return Math.abs(a.length - b.length);
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// ─── JSONL export (SFT-ready) ────────────────────────────────────────────────

const COMPLIANCE_SYSTEM_FOR_TRAINING = `你是中文内容合规审核员。对文章在 6 个维度（政治敏感/色情低俗/暴力恐怖/版权争议/医疗夸大/金融诱导）分别打 0-3 分,并给出整体决策。`;
const DISTRIBUTION_SYSTEM_FOR_TRAINING = `你是社交媒体编辑,把文章改写为 X（Twitter）推文。280 字符内,2-3 hashtag,简洁有力,结尾带链接。`;

export interface ExportRow {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export function buildComplianceTrainingRow(input: any, machine: any, human: any): ExportRow {
  const userText = `标题: ${input.title ?? '—'}\n分类: ${input.category ?? '—'}\n正文:\n${input.content_excerpt ?? ''}`;
  // The "ground truth" assistant output: the human's corrected score map.
  // For approve → all-zero, for reject → max=3 on the most-risky dimension if
  // we knew it; without finer signal we mark the dominant machine-flagged
  // dimension as 3. Falls back to 政治敏感 as a safe placeholder if nothing
  // was flagged.
  const machineScores = machine?.scores ?? null;
  let dominant = '政治敏感';
  if (machineScores && typeof machineScores === 'object') {
    const sorted = Object.entries(machineScores).sort((a, b) => Number(b[1]) - Number(a[1]));
    if (sorted.length > 0) dominant = sorted[0][0];
  }
  const targetScores: Record<string, number> = {
    '政治敏感': 0, '色情低俗': 0, '暴力恐怖': 0,
    '版权争议': 0, '医疗夸大': 0, '金融诱导': 0,
  };
  if (human.decision === 'reject') targetScores[dominant] = 3;
  const reasons: Record<string, string> = {};
  if (human.reason && human.decision === 'reject') reasons[dominant] = human.reason.slice(0, 50);

  return {
    messages: [
      { role: 'system', content: COMPLIANCE_SYSTEM_FOR_TRAINING },
      { role: 'user', content: userText },
      { role: 'assistant', content: JSON.stringify({ scores: targetScores, reasons }, null, 0) },
    ],
  };
}

export function buildDistributionTrainingRow(input: any, _machine: any, human: any): ExportRow {
  const userText =
    `标题: ${input.title ?? '—'}\n` +
    `分类: ${input.category ?? '—'}\n` +
    `标签: ${(input.tags ?? []).slice(0, 5).join('、') || '—'}\n` +
    `摘要: ${input.summary ?? '（无摘要）'}\n` +
    `链接: ${input.published_url ?? ''}`;
  return {
    messages: [
      { role: 'system', content: DISTRIBUTION_SYSTEM_FOR_TRAINING },
      { role: 'user', content: userText },
      { role: 'assistant', content: human.copy },
    ],
  };
}

export interface ExportOpts {
  source: 'compliance' | 'distribution';
  /** Optional limit. Defaults 5000. */
  limit?: number;
  /** If true, only rows where agreement=false (the high-signal ones). Default true. */
  onlyOverrides?: boolean;
}

/**
 * Stream-style export. Caller can write the returned string straight to a file
 * or pipe to a fine-tuning job. We keep it as a single string for simplicity;
 * if volume grows past ~50k examples, refactor to async iterator.
 */
export async function exportJsonl(opts: ExportOpts): Promise<{ jsonl: string; count: number }> {
  const limit = Math.min(opts.limit ?? 5000, 50_000);
  const where = ['source = $1'];
  const params: unknown[] = [opts.source];
  if (opts.onlyOverrides !== false) where.push('agreement = false');
  const sql = `SELECT id, input_data, machine_output, human_label
               FROM training_examples
               WHERE ${where.join(' AND ')}
               ORDER BY created_at DESC
               LIMIT $${params.length + 1}`;
  params.push(limit);

  const rows = await query<{ id: string; input_data: any; machine_output: any; human_label: any }>(sql, params);

  const lines: string[] = [];
  for (const r of rows) {
    const example = opts.source === 'compliance'
      ? buildComplianceTrainingRow(r.input_data, r.machine_output, r.human_label)
      : buildDistributionTrainingRow(r.input_data, r.machine_output, r.human_label);
    lines.push(JSON.stringify(example));
  }
  return { jsonl: lines.join('\n'), count: rows.length };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface FeedbackStats {
  // Total examples we have, by source.
  byCount: Record<string, number>;
  // Override rate proxy: (examples where human acted) / (decisions made).
  // For compliance: REVIEW decisions / all compliance runs.
  // For distribution: edits / all generated copies.
  overrideRate: {
    compliance: { reviews: number; total: number; rate: number };
    distribution: { edits: number; total: number; rate: number };
  };
  // Top-edited terms in distribution copy (frequency analysis on diffs).
  recentlyHarvested: Array<{ source: string; count: number; latest: string }>;
}

export async function feedbackStats(): Promise<FeedbackStats> {
  const [byCount, complianceTotal, complianceReview, distTotal, distEdits, recent] = await Promise.all([
    query<{ source: string; count: number }>(
      `SELECT source, COUNT(*) AS count FROM training_examples GROUP BY source`,
    ),
    query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_runs WHERE agent='compliance' AND status='success'`,
    ),
    query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM operation_logs WHERE operation IN ('compliance.approve', 'compliance.reject')`,
    ),
    query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM distribution_tasks`,
    ),
    query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM operation_logs WHERE operation = 'distribution.edit-copy'`,
    ),
    query<{ source: string; count: number; latest: string }>(
      `SELECT source, COUNT(*) AS count, MAX(created_at) AS latest
         FROM training_examples
         WHERE created_at > NOW() - INTERVAL 7 DAY
         GROUP BY source`,
    ),
  ]);

  const cTotal = complianceTotal[0]?.count ?? 0;
  const cReview = complianceReview[0]?.count ?? 0;
  const dTotal = distTotal[0]?.count ?? 0;
  const dEdits = distEdits[0]?.count ?? 0;

  return {
    byCount: Object.fromEntries(byCount.map((r) => [r.source, r.count])),
    overrideRate: {
      compliance:   { reviews: cReview, total: cTotal, rate: cTotal > 0 ? cReview / cTotal : 0 },
      distribution: { edits: dEdits, total: dTotal, rate: dTotal > 0 ? dEdits / dTotal : 0 },
    },
    recentlyHarvested: recent,
  };
}

// ─── Catch-all harvest poller ────────────────────────────────────────────────
// Runs every HARVEST_INTERVAL_MS (default 5 min) to ensure any op_log rows
// that weren't captured by the inline fire-and-forget triggers are converted.
// Idempotent — UNIQUE on op_log_id means double-runs are harmless.

export function startHarvestPoller(): NodeJS.Timeout {
  const intervalMs = Number(process.env.HARVEST_INTERVAL_MS ?? 5 * 60_000);
  return setInterval(async () => {
    try {
      const [c, d] = await Promise.all([
        harvestComplianceFeedback(),
        harvestDistributionFeedback(),
      ]);
      const inserted = c.inserted + d.inserted;
      if (inserted > 0) {
        console.info(`[harvest] poller: +${c.inserted} compliance, +${d.inserted} distribution`);
      }
    } catch (e: any) {
      console.warn('[harvest] poller error:', e?.message ?? e);
    }
  }, intervalMs);
}
