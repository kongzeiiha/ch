/**
 * Admin endpoints for the feedback loop:
 *   - /admin/training-data/*  — harvested human-feedback samples + JSONL export
 *   - /admin/memory-rules/*   — CRUD for the rules injected into agent prompts
 *   - /admin/feedback-stats   — override-rate KPI used by dashboards
 */
import type { FastifyInstance } from 'fastify';
import { query } from '@ch/db';
import { logOperation } from './op-log.js';
import {
  harvestComplianceFeedback,
  harvestDistributionFeedback,
  exportJsonl,
  feedbackStats,
} from './training-data.js';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
} from './memory-rules.js';

export async function registerFeedbackAdmin(app: FastifyInstance): Promise<void> {

  // ── Training data ────────────────────────────────────────────────────────

  // Manual harvest trigger. Idempotent (UNIQUE on op_log_id), so calling it
  // every minute is safe. A scheduled job would call this on cron.
  app.post('/admin/training-data/harvest', async (req) => {
    const [c, d] = await Promise.all([
      harvestComplianceFeedback(),
      harvestDistributionFeedback(),
    ]);
    await logOperation(req, {
      operation: 'training-data.harvest',
      targetType: 'system',
      targetId: null,
      payload: { compliance: c, distribution: d },
    });
    return { compliance: c, distribution: d };
  });

  // List harvested examples with simple filters.
  app.get<{
    Querystring: { source?: string; agreement?: string; limit?: string; offset?: string };
  }>('/admin/training-data', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (req.query.source) {
      params.push(req.query.source);
      where.push(`source = $${params.length}`);
    }
    if (req.query.agreement === 'true' || req.query.agreement === 'false') {
      params.push(req.query.agreement === 'true');
      where.push(`agreement = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM training_examples ${whereSql}`,
      params,
    );
    params.push(limit);  const limitIdx = params.length;
    params.push(offset); const offsetIdx = params.length;

    const rows = await query(
      `SELECT id, source, item_id, task_id, input_data, machine_output, human_label,
              agreement, used_for_training, created_at::text
       FROM training_examples
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return { examples: rows, total: countRow?.count ?? 0 };
  });

  // Download JSONL ready for SFT. Default `source=compliance`. Marks all
  // exported rows as used_for_training so subsequent exports are diffs only,
  // unless ?fresh=1 is passed (re-export everything).
  app.get<{ Querystring: { source?: string; limit?: string; fresh?: string } }>(
    '/admin/training-data/export',
    async (req, reply) => {
      const source = (req.query.source ?? 'compliance') as 'compliance' | 'distribution';
      if (source !== 'compliance' && source !== 'distribution') {
        return reply.code(400).send({ error: 'source must be compliance or distribution' });
      }
      const limit = Math.min(Number(req.query.limit ?? 5000), 50_000);
      const result = await exportJsonl({ source, limit });

      if (req.query.fresh !== '1' && result.count > 0) {
        // Mark exported rows so future calls only return new ones. We re-fetch
        // ids from the same SELECT to be precise; cheaper than threading them
        // through exportJsonl.
        await query(
          `UPDATE training_examples
             SET used_for_training = true
           WHERE source = $1 AND used_for_training = false
             AND id IN (
               SELECT id FROM training_examples
               WHERE source = $1 AND agreement = false
               ORDER BY created_at DESC LIMIT $2
             )`,
          [source, limit],
        );
      }

      await logOperation(req, {
        operation: 'training-data.export',
        targetType: 'system',
        targetId: null,
        payload: { source, count: result.count, fresh: req.query.fresh === '1' },
      });

      // Use type() (canonical) and `return reply.send()` so Fastify's async
      // resolution doesn't try to serialize the implicit return value to JSON
      // and double-send the headers.
      return reply
        .type('application/x-ndjson; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="ch-${source}-${Date.now()}.jsonl"`)
        .send(result.jsonl);
    },
  );

  // Cheap dashboard counters.
  app.get('/admin/feedback-stats', async () => {
    return feedbackStats();
  });

  // ── Memory rules ─────────────────────────────────────────────────────────

  app.get<{ Querystring: { domain?: string; status?: string } }>(
    '/admin/memory-rules',
    async (req) => {
      const rules = await listRules({ domain: req.query.domain, status: req.query.status });
      return { rules };
    },
  );

  app.post<{
    Body: {
      domain: string;
      rule: string;
      scope?: string | null;
      origin?: 'human' | 'derived';
      derived_from?: string | null;
      notes?: string | null;
    };
  }>('/admin/memory-rules', async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.domain || !b.rule || typeof b.rule !== 'string' || b.rule.trim().length === 0) {
      return reply.code(400).send({ error: 'domain 和 rule 必填' });
    }
    if (b.rule.length > 1000) {
      return reply.code(400).send({ error: 'rule 不能超过 1000 字符' });
    }
    const operator = (req.headers['x-operator'] as string | undefined) ?? null;
    const created = await createRule({
      domain: b.domain,
      scope: b.scope ?? null,
      rule: b.rule,
      origin: b.origin ?? 'human',
      derived_from: b.derived_from ?? null,
      notes: b.notes ?? null,
      created_by: operator,
    });
    await logOperation(req, {
      operation: 'memory-rule.create',
      targetType: 'memory_rule',
      targetId: created.id,
      payload: { domain: b.domain, scope: b.scope ?? null, rule: b.rule, origin: b.origin ?? 'human' },
    });
    return { rule: created };
  });

  app.patch<{
    Params: { id: string };
    Body: { scope?: string | null; rule?: string; status?: 'active' | 'paused' | 'deprecated'; notes?: string | null };
  }>('/admin/memory-rules/:id', async (req, reply) => {
    const updated = await updateRule(req.params.id, req.body ?? {});
    if (!updated) return reply.code(404).send({ error: 'rule not found' });
    await logOperation(req, {
      operation: 'memory-rule.update',
      targetType: 'memory_rule',
      targetId: req.params.id,
      payload: req.body ?? {},
    });
    return { rule: updated };
  });

  app.delete<{ Params: { id: string } }>('/admin/memory-rules/:id', async (req, reply) => {
    const ok = await deleteRule(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'rule not found' });
    await logOperation(req, {
      operation: 'memory-rule.delete',
      targetType: 'memory_rule',
      targetId: req.params.id,
    });
    return { ok: true };
  });
}
