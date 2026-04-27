import type { Job } from 'bullmq';
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES, startWorker, withRun, type Model } from '@ch/agents';
import { runBlacklist } from './blacklist.js';
import { scoreCompliance, type RiskScores } from './score.js';
import { decide } from './decide.js';

export interface ComplianceJob {
  itemId: string;
}

interface ItemRow {
  id: string;
  status: string;
  title: string | null;
  content: string | null;
}

async function complianceOne(itemId: string) {
  const rows = await query<ItemRow>(
    `SELECT id, status, title, content FROM items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) {
    // Item was deleted between queue + dispatch (e.g. a TRUNCATE or cascade
    // delete). Treat as a soft skip — hard-throw burns 3 retries for nothing
    // and pollutes agent_runs with errors.
    return { skipped: true, reason: 'item not found' };
  }
  if (!['COVERED', 'COMPLIANCE_PASS', 'COMPLIANCE_REVIEW', 'COMPLIANCE_FAIL'].includes(item.status)) {
    return { skipped: true, status: item.status };
  }

  const text = `${item.title ?? ''}\n\n${item.content ?? ''}`;
  const blacklistHits = runBlacklist(text);

  let risk: RiskScores | undefined;
  let cost = 0;
  let model: string | null = null;
  let usage: any;

  const skipLlm = process.env.COMPLIANCE_SKIP_LLM === '1';

  if (blacklistHits.length === 0 && !skipLlm) {
    try {
      const r = await scoreCompliance(
        { title: item.title, content: item.content ?? '' },
        { model: (process.env.COMPLIANCE_MODEL as Model) ?? 'sonnet' },
      );
      risk = r.result;
      cost = r.cost;
      model = r.model;
      usage = r.usage;
    } catch (e: any) {
      // L2 failed — decide() will send to REVIEW queue
      console.warn(`[compliance] LLM score failed for ${itemId}: ${e?.message}`);
    }
  }

  // When LLM is skipped and L1 is clean, synthesize a zero-risk score so
  // decide() auto-passes instead of defaulting to REVIEW.
  if (skipLlm && blacklistHits.length === 0 && !risk) {
    risk = {
      scores: {
        '政治敏感': 0, '色情低俗': 0, '暴力恐怖': 0,
        '版权争议': 0, '医疗夸大': 0, '金融诱导': 0,
      },
      reasons: {},
    };
  }

  const decision = decide(blacklistHits, risk);

  await query(
    `UPDATE items
       SET status = $2,
           compliance_status = $2,
           risk_tags = $3,
           compliance_reasons = $4
     WHERE id = $1`,
    [
      itemId,
      decision.status,
      decision.risk_tags,
      JSON.stringify({
        trigger: decision.trigger,
        maxScore: decision.maxScore,
        blacklist: blacklistHits,
        scores: risk?.scores ?? null,
        reasons: risk?.reasons ?? null,
      }),
    ],
  );

  if (decision.status === 'COMPLIANCE_PASS') {
    await getQueue(QUEUE_NAMES.publishing).add(
      'publish',
      { itemId },
      { jobId: `publish__${itemId}` },
    );
  }

  return {
    decision: decision.status,
    trigger: decision.trigger,
    maxScore: decision.maxScore,
    risk_tags: decision.risk_tags,
    blacklistHits: blacklistHits.length,
    cost,
    model,
    usage,
  };
}

export function startComplianceWorker() {
  return startWorker<ComplianceJob>(
    QUEUE_NAMES.compliance,
    async (job: Job<ComplianceJob>) => {
      return withRun({ agent: 'compliance', itemId: job.data.itemId }, async () => {
        const out = await complianceOne(job.data.itemId);
        return { output: out, model: (out as any).model ?? undefined, usage: (out as any).usage, cost: (out as any).cost };
      });
    },
    { concurrency: 1 },
  );
}
