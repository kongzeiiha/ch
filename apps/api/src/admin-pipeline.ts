/**
 * Pipeline Control API
 * Manages automation state, human gates, rollback, re-run, and per-item audit trails.
 *
 * Human gate rules (hard-coded, cannot be disabled):
 *   - COMPLIANCE_REVIEW items → require human approve/reject
 *   - Publishing             → require human batch-approve (COMPLIANCE_PASS → queue)
 *   - Distribution copy      → human reviews generated copy before posting
 */

import type { FastifyInstance } from 'fastify';
import { query, execute, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { logOperation } from './op-log.js';
import { revalidatePaths } from './workers/publishing/revalidate.js';
import { harvestComplianceFeedback } from './training-data.js';
import { deleteObjects, collectCoverKeys } from './workers/cover/storage.js';

// ── In-memory automation state (single-process MVP) ───────────────────────
// Key = agent key (see AGENT_KEYS below), value = true/false
export const autoState: Map<string, boolean> = new Map([
  ['source-scoring',   false],
  ['ingestion',        false],
  ['classify-title',   true],   // merged from old classification+title; safe to auto
  ['cover',            true],
  ['compliance',       true],
  ['publishing',       false],  // HUMAN GATE — cannot auto by default
  ['distribution',     false],  // HUMAN GATE
  ['analytics',        false],
]);

export const pausedState: Map<string, boolean> = new Map();
export let globalStop = false;

export function setGlobalStop(v: boolean) { globalStop = v; }

// Status → agent that processes it next when /rerun is invoked.
// Terminal-ish states (FAIL/REVIEW/DISTRIBUTED) re-enter the same agent that
// last touched them so a manual rerun does the right thing after rule edits
// or a transient LLM failure (instead of erroring out as "no agent mapped").
const STATUS_TO_AGENT: Record<string, string> = {
  [IS.INGESTED]:           'classify-title',
  [IS.CLASSIFIED]:         'classify-title', // legacy backlog — picked up to finish title step
  [IS.TITLED]:             'cover',
  [IS.COVERED]:            'compliance',
  [IS.COMPLIANCE_PASS]:    'publishing',
  [IS.COMPLIANCE_REVIEW]:  'compliance',     // re-score after rule edits
  [IS.COMPLIANCE_FAIL]:    'compliance',     // give it another shot post-fix
  [IS.PUBLISHED]:          'distribution',
  [IS.DISTRIBUTED]:        'distribution',   // re-generate copy / re-post
};

// Agent → queue action.
// Every handoff sets `removeOnComplete: true` on the per-item job opts so the
// deterministic jobId is freed once the job runs. Without that, BullMQ dedupes
// the new add() against the historical completed job (kept for 7 days by the
// queue default), and the rerun is silently dropped — which is how the
// rollback → re-cover → re-comply → re-publish chain got stuck pre-fix.
const HANDOFF_OPTS = { removeOnComplete: true } as const;

const AGENT_QUEUE_ACTION: Record<string, () => Promise<{ queued: number }>> = {
  'classify-title': async () => {
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status = ANY($1::text[]) LIMIT 200`,
      [[IS.INGESTED, IS.CLASSIFIED]],
    );
    if (items.length === 0) return { queued: 0 };
    await getQueue(QUEUE_NAMES.classifyTitle).addBulk(
      items.map(({ id }) => ({ name: 'classify-title', data: { itemId: id }, opts: { jobId: `classify-title__${id}`, ...HANDOFF_OPTS } })),
    );
    return { queued: items.length };
  },
  cover: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1 LIMIT 200`, [IS.TITLED]);
    if (items.length === 0) return { queued: 0 };
    await getQueue(QUEUE_NAMES.cover).addBulk(
      items.map(({ id }) => ({ name: 'cover', data: { itemId: id }, opts: { jobId: `cover__${id}`, ...HANDOFF_OPTS } })),
    );
    return { queued: items.length };
  },
  compliance: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1 LIMIT 200`, [IS.COVERED]);
    if (items.length === 0) return { queued: 0 };
    await getQueue(QUEUE_NAMES.compliance).addBulk(
      items.map(({ id }) => ({ name: 'compliance', data: { itemId: id }, opts: { jobId: `compliance__${id}`, ...HANDOFF_OPTS } })),
    );
    return { queued: items.length };
  },
  publishing: async () => {
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status = $1 AND slug IS NOT NULL LIMIT 200`,
      [IS.COMPLIANCE_PASS],
    );
    if (items.length === 0) return { queued: 0 };
    await getQueue(QUEUE_NAMES.publishing).addBulk(
      items.map(({ id }) => ({ name: 'publish', data: { itemId: id }, opts: { jobId: `publish__${id}`, ...HANDOFF_OPTS } })),
    );
    return { queued: items.length };
  },
  distribution: async () => {
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status = $1
       AND NOT EXISTS (SELECT 1 FROM distribution_tasks WHERE item_id=items.id AND channel='twitter')
       LIMIT 100`,
      [IS.PUBLISHED],
    );
    if (items.length === 0) return { queued: 0 };
    await getQueue(QUEUE_NAMES.distribution).addBulk(
      items.map(({ id }) => ({ name: 'distribute', data: { itemId: id, channel: 'twitter' }, opts: { jobId: `dist__twitter__${id}`, ...HANDOFF_OPTS } })),
    );
    return { queued: items.length };
  },
  'source-scoring': async () => {
    const q = getQueue(QUEUE_NAMES.sourceScoring);
    await q.add('score', {}, { jobId: `score__manual__${Date.now()}` });
    return { queued: 1 };
  },
  ingestion: async () => {
    const q = getQueue(QUEUE_NAMES.ingestion);
    await q.add('fanout', { kind: 'fanout' }, { jobId: `fanout__${Date.now()}` });
    return { queued: 1 };
  },
  analytics: async () => {
    const q = getQueue(QUEUE_NAMES.analytics);
    await q.add('analytics', { kind: 'pull' }, { jobId: `analytics__pull__${Date.now()}` });
    return { queued: 1 };
  },
};

// Rollback map: status → previous status + fields to clear
const ROLLBACK_MAP: Record<string, { toStatus: string; clearFields?: string[] }> = {
  [IS.CLASSIFIED]:        { toStatus: IS.INGESTED,        clearFields: ['category', 'tags', 'keywords'] },
  [IS.TITLED]:            { toStatus: IS.INGESTED,        clearFields: ['category', 'tags', 'keywords', 'title', 'summary', 'slug'] },
  [IS.COVERED]:           { toStatus: IS.TITLED,          clearFields: ['cover_url', 'cover_sizes', 'cover_copy'] },
  [IS.COMPLIANCE_PASS]:   { toStatus: IS.COVERED,         clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  [IS.COMPLIANCE_FAIL]:   { toStatus: IS.COVERED,         clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  [IS.COMPLIANCE_REVIEW]: { toStatus: IS.COVERED,         clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  [IS.PUBLISHED]:         { toStatus: IS.COMPLIANCE_PASS, clearFields: ['published_url', 'published_at'] },
  [IS.DISTRIBUTED]:       { toStatus: IS.PUBLISHED },
};

export async function registerPipelineAdmin(app: FastifyInstance) {

  // ── Automation state ──────────────────────────────────────────────────

  app.get('/admin/pipeline/state', async () => {
    const pending = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) AS cnt FROM items GROUP BY status`,
    );
    const pendingMap = Object.fromEntries(pending.map((r) => [r.status, r.cnt]));

    const reviewQueue = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM items WHERE status = $1`,
      [IS.COMPLIANCE_REVIEW],
    );
    const publishQueue = await query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM items WHERE status = $1`,
      [IS.COMPLIANCE_PASS],
    );

    return {
      globalStop,
      agents: Object.fromEntries(
        [...autoState.keys()].map((k) => [k, {
          auto: autoState.get(k) ?? false,
          paused: pausedState.get(k) ?? false,
        }]),
      ),
      pendingMap,
      reviewQueueSize: reviewQueue[0]?.cnt ?? 0,
      publishQueueSize: publishQueue[0]?.cnt ?? 0,
    };
  });

  app.post('/admin/pipeline/set-auto', async (req, reply) => {
    const { agent, auto } = req.body as { agent: string; auto: boolean };
    if (!autoState.has(agent)) return reply.status(400).send({ error: 'unknown agent' });
    // Publishing and distribution can be set to auto only with explicit acknowledgment
    if ((agent === 'publishing' || agent === 'distribution') && auto) {
      const { ack } = req.body as { ack?: boolean };
      if (!ack) return reply.status(400).send({ error: `${agent} is a human gate. Pass ack:true to confirm auto mode.` });
    }
    const before = autoState.get(agent) ?? false;
    autoState.set(agent, auto);
    await logOperation(req, {
      operation: 'pipeline.set-auto',
      targetType: 'agent',
      targetId: agent,
      payload: { before, after: auto },
    });
    return { agent, auto };
  });

  app.post('/admin/pipeline/set-paused', async (req, reply) => {
    const { agent, paused } = req.body as { agent: string; paused: boolean };
    if (!autoState.has(agent)) return reply.status(400).send({ error: 'unknown agent' });
    const before = pausedState.get(agent) ?? false;
    pausedState.set(agent, paused);
    await logOperation(req, {
      operation: 'pipeline.set-paused',
      targetType: 'agent',
      targetId: agent,
      payload: { before, after: paused },
    });
    return { agent, paused };
  });

  app.post('/admin/pipeline/emergency-stop', async (req) => {
    setGlobalStop(true);
    await logOperation(req, {
      operation: 'system.emergency-stop',
      targetType: 'system',
      targetId: null,
    });
    return { stopped: true };
  });

  app.post('/admin/pipeline/resume', async (req) => {
    setGlobalStop(false);
    await logOperation(req, {
      operation: 'system.resume',
      targetType: 'system',
      targetId: null,
    });
    return { stopped: false };
  });

  // Manually trigger one agent step
  app.post('/admin/pipeline/run/:agent', async (req, reply) => {
    const { agent } = req.params as { agent: string };
    const action = AGENT_QUEUE_ACTION[agent];
    if (!action) return reply.status(400).send({ error: 'unknown agent' });
    if (globalStop) return reply.status(503).send({ error: 'global stop is active' });
    const result = await action();
    return result;
  });

  // ── Human review gates ────────────────────────────────────────────────

  // Items pending compliance review (machine suggested REVIEW)
  app.get('/admin/pipeline/review-queue', async () => {
    const items = await query<{
      id: string; title: string; category: string | null; slug: string | null;
      compliance_status: string | null; risk_tags: string[]; compliance_reasons: unknown;
      cover_url: string | null; summary: string | null; source: string; url: string;
    }>(
      `SELECT i.id, i.title, i.category, i.slug, i.compliance_status,
              i.risk_tags, i.compliance_reasons, i.cover_url, i.summary,
              s.name AS source, r.url
       FROM items i
       JOIN sources s ON s.id = i.source_id
       JOIN raw_items r ON r.id = i.raw_item_id
       WHERE i.status = $1
       ORDER BY i.updated_at DESC`,
      [IS.COMPLIANCE_REVIEW],
    );
    return { items };
  });

  // Recently blocked items (COMPLIANCE_FAIL). Read-only audit surface so the
  // workbench can show *what* the compliance gate is rejecting + *why* without
  // forcing the operator into the dedicated /admin/cover-compliance page.
  app.get('/admin/pipeline/blocked-queue', async () => {
    const items = await query<{
      id: string; title: string; category: string | null;
      risk_tags: any; compliance_reasons: any;
      summary: string | null; source: string; updated_at: string;
    }>(
      `SELECT i.id, i.title, i.category, i.risk_tags, i.compliance_reasons,
              i.summary, s.name AS source, i.updated_at
       FROM items i
       JOIN sources s ON s.id = i.source_id
       WHERE i.status = $1
       ORDER BY i.updated_at DESC
       LIMIT 50`,
      [IS.COMPLIANCE_FAIL],
    );
    return { items };
  });

  // Approve compliance review → COMPLIANCE_PASS + optionally queue for publishing
  app.post('/admin/pipeline/approve-review/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const r = await execute(
      `UPDATE items SET status=$2, compliance_status='manual_pass'
       WHERE id=$1 AND status=$3`,
      [itemId, IS.COMPLIANCE_PASS, IS.COMPLIANCE_REVIEW],
    );
    if (r.affectedRows === 0) return reply.status(409).send({ error: 'item not in compliance_review state' });
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
       VALUES ('human:review', $1, 'success', '{"decision":"approve"}', NOW())`,
      [itemId],
    );
    await logOperation(req, {
      operation: 'compliance.approve',
      targetType: 'item',
      targetId: itemId,
      payload: { decision: 'approve' },
    });
    void harvestComplianceFeedback().catch((e) =>
      console.warn('[harvest] compliance approve:', e?.message ?? e),
    );
    return { approved: itemId };
  });

  // Reject compliance review → COMPLIANCE_FAIL
  app.post('/admin/pipeline/reject-review/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { reason } = (req.body as { reason?: string }) ?? {};
    const r = await execute(
      `UPDATE items SET status=$2, compliance_status='manual_fail'
       WHERE id=$1 AND status=$3`,
      [itemId, IS.COMPLIANCE_FAIL, IS.COMPLIANCE_REVIEW],
    );
    if (r.affectedRows === 0) return reply.status(409).send({ error: 'item not in compliance_review state' });
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, error, finished_at)
       VALUES ('human:review', $1, 'success', '{"decision":"reject"}', $2, NOW())`,
      [itemId, reason ?? null],
    );
    await logOperation(req, {
      operation: 'compliance.reject',
      targetType: 'item',
      targetId: itemId,
      payload: { decision: 'reject', reason: reason ?? null },
    });
    void harvestComplianceFeedback().catch((e) =>
      console.warn('[harvest] compliance reject:', e?.message ?? e),
    );
    return { rejected: itemId };
  });

  // Audit trail of human-approved items (last 50). Combines two sources:
  //   - approve-review:  COMPLIANCE_REVIEW → COMPLIANCE_PASS  (mild override)
  //   - override-block:  COMPLIANCE_FAIL   → COMPLIANCE_PASS  (hard override)
  // Each carries the operator name (from op_logs) and the original risk_tags.
  app.get('/admin/pipeline/passed-queue', async () => {
    const items = await query<{
      id: string;
      item_id: string | null;
      title: string | null;
      source: string | null;
      kind: 'approve' | 'override';
      operator: string | null;
      reason: string | null;
      risk_tags: any;
      finished_at: string;
    }>(
      `SELECT ar.id, ar.item_id, i.title, s.name AS source,
              CASE WHEN ar.agent = 'human:override' THEN 'override' ELSE 'approve' END AS kind,
              ol.operator, ar.error AS reason, i.risk_tags,
              ar.finished_at
       FROM agent_runs ar
       LEFT JOIN items i ON i.id = ar.item_id
       LEFT JOIN sources s ON s.id = i.source_id
       LEFT JOIN operation_logs ol
         ON ol.target_id = ar.item_id
        AND ol.operation IN ('compliance.approve','compliance.override')
        AND ABS(TIMESTAMPDIFF(SECOND, ol.occurred_at, ar.finished_at)) < 5
       WHERE ar.agent IN ('human:override','human:review')
         AND ar.finished_at > NOW() - INTERVAL 7 DAY
         AND (
           ar.agent = 'human:override'
           OR JSON_UNQUOTE(JSON_EXTRACT(ar.output, '$.decision')) = 'approve'
         )
       ORDER BY ar.finished_at DESC
       LIMIT 50`,
    );
    return { items };
  });

  // Manual override on a blocked item: FAIL → PASS. Used when the operator
  // disagrees with the gate (false positive on blacklist regex, or LLM was
  // wrong, or rules changed but the item didn't go through rerun).
  // Writes a feedback signal to training_examples so the rule can be tuned.
  app.post('/admin/pipeline/override-block/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { reason } = (req.body as { reason?: string }) ?? {};
    const r = await execute(
      `UPDATE items SET status=$2, compliance_status='manual_pass'
       WHERE id=$1 AND status=$3`,
      [itemId, IS.COMPLIANCE_PASS, IS.COMPLIANCE_FAIL],
    );
    if (r.affectedRows === 0) return reply.status(409).send({ error: 'item not in compliance_fail state' });
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, error, finished_at)
       VALUES ('human:override', $1, 'success', '{"decision":"override"}', $2, NOW())`,
      [itemId, reason ?? null],
    );
    await logOperation(req, {
      operation: 'compliance.override',
      targetType: 'item',
      targetId: itemId,
      payload: { decision: 'override', reason: reason ?? null },
    });
    void harvestComplianceFeedback().catch((e) =>
      console.warn('[harvest] compliance override:', e?.message ?? e),
    );
    return { overridden: itemId };
  });

  // Items waiting for publish approval (COMPLIANCE_PASS, not yet published)
  app.get('/admin/pipeline/publish-queue', async () => {
    const items = await query<{
      id: string; title: string; category: string | null; slug: string | null;
      cover_url: string | null; cover_sizes: unknown; summary: string | null; source: string;
    }>(
      `SELECT i.id, i.title, i.category, i.slug, i.cover_url, i.cover_sizes, i.summary,
              s.name AS source
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE i.status = $1
       ORDER BY i.updated_at DESC`,
      [IS.COMPLIANCE_PASS],
    );
    return { items };
  });

  // Recently published items (PUBLISHED + DISTRIBUTED). Drives the "已上站"
  // strip on the publishing agent card so the operator can see what just
  // went live without leaving the workbench.
  app.get('/admin/pipeline/published-queue', async () => {
    const items = await query<{
      id: string; title: string; category: string | null; slug: string | null;
      source: string; published_at: string; status: string;
    }>(
      `SELECT i.id, i.title, i.category, i.slug, s.name AS source,
              i.published_at, i.status
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE i.status IN ($1, $2) AND i.published_at IS NOT NULL
       ORDER BY i.published_at DESC
       LIMIT 50`,
      [IS.PUBLISHED, IS.DISTRIBUTED],
    );
    return { items };
  });

  // Approve items for publishing (batch or single)
  app.post('/admin/pipeline/approve-publish', async (req) => {
    const { itemIds } = req.body as { itemIds?: string[] };
    const candidates = itemIds
      ? await query<{ id: string }>(`SELECT id FROM items WHERE id = ANY($1) AND status = $2`, [itemIds, IS.COMPLIANCE_PASS])
      : await query<{ id: string }>(`SELECT id FROM items WHERE status=$1 LIMIT 200`, [IS.COMPLIANCE_PASS]);

    if (candidates.length === 0) return { queued: 0 };
    const ids = candidates.map((c) => c.id);

    // See HANDOFF_OPTS — removeOnComplete frees the deterministic jobId on
    // success so a re-publish (after rollback / unpublish) isn't silently
    // dropped by dedup against the historical `publish__<id>` in `completed`.
    await getQueue(QUEUE_NAMES.publishing).addBulk(
      ids.map((id) => ({
        name: 'publish',
        data: { itemId: id },
        opts: { jobId: `publish__${id}`, ...HANDOFF_OPTS },
      })),
    );
    // Single multi-row INSERT — one round-trip regardless of batch size.
    const valueRows = ids.map((_, i) => `('human:publish-gate', $${i + 1}, 'success', '{"decision":"approve"}', NOW())`).join(', ');
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at) VALUES ${valueRows}`,
      ids,
    );
    // Per-item operation log so single-item history shows the publish event.
    await Promise.all(ids.map((id) =>
      logOperation(req, {
        operation: 'publish.approve',
        targetType: 'item',
        targetId: id,
        payload: { batch: itemIds ? true : false },
      }),
    ));
    return { queued: candidates.length };
  });

  // Distribution queue: PUBLISHED items + their generated copy
  app.get('/admin/pipeline/distribution-queue', async () => {
    const rows = await query<{
      item_id: string; title: string; slug: string | null;
      task_id: string; channel: string; copy: string; status: string; created_at: string;
    }>(
      `SELECT dt.item_id, i.title, i.slug,
              dt.id AS task_id, dt.channel, dt.copy, dt.status, dt.created_at
       FROM distribution_tasks dt
       JOIN items i ON i.id = dt.item_id
       WHERE dt.status = 'pending'
       ORDER BY dt.created_at DESC`,
    );
    return { tasks: rows };
  });

  // Mark distribution task as manually posted (human confirmed)
  app.post('/admin/pipeline/confirm-distribution/:taskId', async (req) => {
    const { taskId } = req.params as { taskId: string };
    const before = await query<{ item_id: string; channel: string; status: string }>(
      `SELECT item_id, channel, status FROM distribution_tasks WHERE id=$1`,
      [taskId],
    );
    await query(
      `UPDATE distribution_tasks SET status='done', executed_at=NOW() WHERE id=$1`,
      [taskId],
    );
    await query(
      `UPDATE items SET status=$2
       WHERE id=(SELECT item_id FROM distribution_tasks WHERE id=$1)
         AND status=$3`,
      [taskId, IS.DISTRIBUTED, IS.PUBLISHED],
    );
    await logOperation(req, {
      operation: 'distribution.confirm',
      targetType: 'distribution_task',
      targetId: taskId,
      payload: {
        itemId: before[0]?.item_id ?? null,
        channel: before[0]?.channel ?? null,
        previousStatus: before[0]?.status ?? null,
      },
    });
    return { confirmed: taskId };
  });

  // ── Rollback & Re-run ─────────────────────────────────────────────────

  app.post('/admin/pipeline/rollback/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const rows = await query<{
      id: string; status: string; slug: string | null; category: string | null;
      cover_url: string | null; cover_sizes: any;
    }>(
      `SELECT id, status, slug, category, cover_url, cover_sizes FROM items WHERE id=$1`,
      [itemId],
    );
    const item = rows[0];
    if (!item) return reply.status(404).send({ error: 'item not found' });

    const rb = ROLLBACK_MAP[item.status];
    if (!rb) return reply.status(400).send({ error: `no rollback defined for status=${item.status}` });

    // If this rollback nulls out cover_url / cover_sizes, snapshot the keys
    // BEFORE the UPDATE so we can purge MinIO afterwards. Without this, every
    // rollback (or repeated re-cover with a different gallery size) leaves
    // dead objects accumulating in the bucket.
    const willClearCover =
      (rb.clearFields ?? []).some((f) => f === 'cover_url' || f === 'cover_sizes');
    const coverKeysToPurge = willClearCover
      ? collectCoverKeys(item.cover_url, item.cover_sizes)
      : [];

    // tags / keywords / risk_tags are `json NOT NULL DEFAULT (json_array())`
    // — resetting them to NULL violates the constraint, so they get reset to
    // an empty JSON array. All other clearable fields are nullable.
    const NOT_NULL_JSON_ARRAY = new Set(['tags', 'keywords', 'risk_tags']);
    const clearSet = rb.clearFields
      ?.map((f) => `\`${f}\`=${NOT_NULL_JSON_ARRAY.has(f) ? 'JSON_ARRAY()' : 'NULL'}`)
      .join(', ');
    const sql = `UPDATE items SET status=$2${clearSet ? `, ${clearSet}` : ''} WHERE id=$1`;
    await query(sql, [itemId, rb.toStatus]);

    // Best-effort S3 purge after the DB update. Never block the rollback on
    // MinIO availability — an orphan object is recoverable, but a half-rolled-
    // back item where the DB cleared and S3 didn't is also fine because the
    // re-cover step will overwrite the same keys on the next pass.
    let purgedS3 = 0;
    if (coverKeysToPurge.length > 0) {
      purgedS3 = await deleteObjects(coverKeysToPurge).catch((e) => {
        req.log?.warn({ err: e }, 'cover S3 purge failed during rollback');
        return 0;
      });
    }

    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
       VALUES ('human:rollback', $1, 'success', $2, NOW())`,
      [itemId, JSON.stringify({ from: item.status, to: rb.toStatus })],
    );
    // PUBLISHED → COMPLIANCE_PASS rollback is the "紧急下线" path. Tag it
    // distinctly so the audit log can call it out vs. ordinary state rollback.
    const isUnpublish = item.status === IS.PUBLISHED;
    // Drop the article from Next.js ISR cache so it actually disappears from
    // the live site — without this the row is unpublished in DB but the page
    // keeps serving from cache until the next regen.
    if (isUnpublish && item.slug) {
      const paths = ['/', `/a/${item.slug}`, '/sitemap.xml'];
      if (item.category) paths.push(`/category/${encodeURIComponent(item.category)}`);
      await revalidatePaths(paths);
    }
    await logOperation(req, {
      operation: isUnpublish ? 'item.unpublish' : 'item.rollback',
      targetType: 'item',
      targetId: itemId,
      payload: {
        from: item.status,
        to: rb.toStatus,
        clearedFields: rb.clearFields ?? [],
        purgedS3Keys: purgedS3,
      },
    });
    return { itemId, from: item.status, to: rb.toStatus, purgedS3Keys: purgedS3 };
  });

  app.post('/admin/pipeline/rerun/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { forceAgent } = (req.body as { forceAgent?: string }) ?? {};

    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM items WHERE id=$1`,
      [itemId],
    );
    const item = rows[0];
    if (!item) return reply.status(404).send({ error: 'item not found' });

    const agentKey = forceAgent ?? STATUS_TO_AGENT[item.status];
    if (!agentKey) return reply.status(400).send({ error: `no agent mapped for status=${item.status}` });

    const queueMap: Record<string, string> = {
      'classify-title': QUEUE_NAMES.classifyTitle,
      cover:            QUEUE_NAMES.cover,
      compliance:       QUEUE_NAMES.compliance,
      publishing:       QUEUE_NAMES.publishing,
      distribution:     QUEUE_NAMES.distribution,
    };
    const qname = queueMap[agentKey];
    if (!qname) return reply.status(400).send({ error: `no queue for agent=${agentKey}` });

    const jobData: Record<string, unknown> =
      agentKey === 'distribution' ? { itemId, channel: 'twitter' } : { itemId };
    const jobId = `rerun__${agentKey}__${itemId}__${Date.now()}`;
    await getQueue(qname as Parameters<typeof getQueue>[0]).add(agentKey, jobData, { jobId });

    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
       VALUES ('human:rerun', $1, 'success', $2, NOW())`,
      [itemId, JSON.stringify({ agent: agentKey, jobId })],
    );
    await logOperation(req, {
      operation: 'item.rerun',
      targetType: 'item',
      targetId: itemId,
      payload: { agent: agentKey, jobId, fromStatus: item.status },
    });
    return { itemId, agentKey, jobId };
  });

  // ── Per-item audit trail ──────────────────────────────────────────────

  app.get('/admin/pipeline/item-history/:itemId', async (req) => {
    const { itemId } = req.params as { itemId: string };
    const [item, runs] = await Promise.all([
      query(
        `SELECT i.id, i.status, i.title, i.slug, i.category, i.tags, i.keywords,
                i.cover_url, i.cover_sizes, i.compliance_status, i.risk_tags,
                i.compliance_reasons, i.published_url,
                i.summary, i.content,
                i.created_at, i.updated_at,
                s.name AS source, r.url AS original_url
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN raw_items r ON r.id = i.raw_item_id
         WHERE i.id=$1`,
        [itemId],
      ),
      query(
        `SELECT id, agent, status, latency_ms, cost_usd,
                CASE WHEN length(error)>200 THEN CONCAT(left(error,200),'…') ELSE error END AS error,
                output, started_at, finished_at
         FROM agent_runs WHERE item_id=$1
         ORDER BY started_at ASC`,
        [itemId],
      ),
    ]);
    if (!item[0]) return { error: 'not found' };
    return { item: item[0], runs };
  });

  // Live snapshot: per-agent list of currently-active jobs (plus last few
  // completed). Drives the "在处理" strip inside each workbench agent card.
  app.get('/admin/pipeline/live-jobs', async () => {
    const AGENT_QUEUES: Array<{ key: string; queue: keyof typeof QUEUE_NAMES }> = [
      { key: 'source-scoring', queue: 'sourceScoring' },
      { key: 'ingestion',      queue: 'ingestion' },
      { key: 'classify-title', queue: 'classifyTitle' },
      { key: 'cover',          queue: 'cover' },
      { key: 'compliance',     queue: 'compliance' },
      { key: 'publishing',     queue: 'publishing' },
      { key: 'distribution',   queue: 'distribution' },
      { key: 'analytics',      queue: 'analytics' },
    ];

    const active: Record<string, Array<{ itemId: string | null; label: string; since: string | null }>> = {};
    const itemIdsToLookup = new Set<string>();

    // Pass 1: fetch active jobs from all 8 queues in parallel
    const perAgentActive = await Promise.all(
      AGENT_QUEUES.map(async ({ key, queue }) => {
        const jobs = await getQueue(QUEUE_NAMES[queue] as any).getActive(0, 8);
        const decoded = jobs.map((j) => {
          const d = j.data as any;
          return {
            itemId: (d?.itemId ?? null) as string | null,
            raw: d,
            since: j.processedOn ? new Date(j.processedOn).toISOString() : null,
          };
        });
        return { key, jobs: decoded };
      }),
    );
    for (const { jobs } of perAgentActive) {
      for (const j of jobs) {
        if (j.itemId) itemIdsToLookup.add(j.itemId);
      }
    }

    // Batch lookup item titles
    const titleMap = new Map<string, { title: string | null; source: string | null }>();
    if (itemIdsToLookup.size > 0) {
      const rows = await query<{ id: string; title: string | null; source: string | null }>(
        `SELECT i.id, i.title, s.name AS source
         FROM items i JOIN sources s ON s.id = i.source_id
         WHERE i.id = ANY($1::uuid[])`,
        [Array.from(itemIdsToLookup)],
      );
      for (const r of rows) titleMap.set(r.id, { title: r.title, source: r.source });
    }

    // Source names for ingestion jobs (data.sourceId)
    const sourceIdsToLookup = new Set<string>();
    for (const { jobs } of perAgentActive) {
      for (const j of jobs) {
        if (j.raw?.sourceId) sourceIdsToLookup.add(j.raw.sourceId);
      }
    }
    const sourceMap = new Map<string, string>();
    if (sourceIdsToLookup.size > 0) {
      const rows = await query<{ id: string; name: string }>(
        `SELECT id, name FROM sources WHERE id = ANY($1::uuid[])`,
        [Array.from(sourceIdsToLookup)],
      );
      for (const r of rows) sourceMap.set(r.id, r.name);
    }

    // Pass 2: build labels
    for (const { key, jobs } of perAgentActive) {
      active[key] = jobs.map((j) => {
        let label = '—';
        if (j.itemId) {
          const info = titleMap.get(j.itemId);
          label = info?.title ? `${info.title}${info.source ? ` · ${info.source}` : ''}` : `item ${j.itemId.slice(0, 8)}`;
        } else if (j.raw?.sourceId) {
          label = `源：${sourceMap.get(j.raw.sourceId) ?? j.raw.sourceId.slice(0, 8)}`;
        } else if (j.raw?.kind === 'fanout') {
          label = '全量 fanout';
        } else {
          label = JSON.stringify(j.raw).slice(0, 60);
        }
        return { itemId: j.itemId, label, since: j.since };
      });
    }

    // Recent completed (last 8 per agent from agent_runs).
    // Output is included so per-agent summarizers (e.g. source-scoring's score
    // deltas) can render meaningful text without an extra round-trip.
    const recent = await query<{
      agent: string; item_id: string | null; input_hash: string | null; title: string | null;
      category: string | null; tags: any;
      finished_at: string; latency_ms: number | null; status: string;
      output: any;
    }>(
      `SELECT ar.agent, ar.item_id, ar.input_hash, i.title, i.category, i.tags,
              ar.finished_at AS finished_at, ar.latency_ms, ar.status, ar.output
       FROM (
         SELECT agent, item_id, input_hash, finished_at, latency_ms, status, output,
                ROW_NUMBER() OVER (PARTITION BY agent ORDER BY finished_at DESC) AS rn
         FROM agent_runs WHERE finished_at IS NOT NULL
       ) ar
       LEFT JOIN items i ON i.id = ar.item_id
       WHERE ar.rn <= 8`,
    );

    // Ingestion runs key on source_id via input_hash. Batch-resolve names so
    // each "最近完成" entry can show "源名 · 候选 N · 入库 K …" instead of a uuid.
    const ingestionSourceIds = new Set<string>();
    for (const r of recent) {
      if (r.agent === 'ingestion' && r.input_hash) ingestionSourceIds.add(r.input_hash);
    }
    const recentSourceMap = new Map<string, string>();
    if (ingestionSourceIds.size > 0) {
      const rows = await query<{ id: string; name: string }>(
        `SELECT id, name FROM sources WHERE id = ANY($1::uuid[])`,
        [Array.from(ingestionSourceIds)],
      );
      for (const r of rows) recentSourceMap.set(r.id, r.name);
    }

    type RecentRow = {
      agent: string; item_id: string | null; title: string | null;
      category: string | null; tags: string[] | null;
      finished_at: string; latency_ms: number | null; status: string;
      summary?: string; movers?: Array<{ name: string; before: number; after: number }>;
    };

    // mysql2 returns JSON columns as parsed objects/arrays. Be defensive:
    // older rows or string-typed payloads should still cleanly become arrays.
    const parseTags = (raw: any): string[] | null => {
      if (Array.isArray(raw)) return raw as string[];
      if (typeof raw === 'string') {
        try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
      }
      return null;
    };

    const recentByAgent: Record<string, RecentRow[]> = {};
    for (const r of recent) {
      const bucket = r.agent.split(':')[0];
      const out: RecentRow = {
        agent: r.agent,
        item_id: r.item_id,
        title: r.title,
        category: r.category,
        tags: parseTags(r.tags),
        finished_at: r.finished_at,
        latency_ms: r.latency_ms,
        status: r.status,
      };
      // Summarize ingestion output: source name + candidate→ingest funnel.
      // Two flavors: 'ingestion' (single source) and 'ingestion:fanout' (enqueue dispatch).
      if (bucket === 'ingestion' && r.output) {
        const o = typeof r.output === 'string' ? safeJsonParse(r.output) : r.output;
        if (r.agent === 'ingestion:fanout' && o) {
          const enq = Number(o.enqueued ?? 0);
          const skip = Number(o.skipped ?? 0);
          out.summary = `全量 fanout · 入队 ${enq}${skip > 0 ? ` · 跳过 ${skip}` : ''}`;
        } else if (r.agent === 'ingestion' && o) {
          const srcName = (r.input_hash && recentSourceMap.get(r.input_hash))
            ?? (r.input_hash ? r.input_hash.slice(0, 8) : '未知源');
          const candidates = Number(o.candidates ?? 0);
          const ingested = Number(o.ingested ?? 0);
          const dup = Number(o.dupUrl ?? 0) + Number(o.dupContent ?? 0);
          const fail = Number(o.cleanFail ?? 0) + Number(o.errors ?? 0);
          const parts: string[] = [srcName];
          if (o.authFail) parts.push(`🔒 鉴权失败${o.authStatus ? ` ${o.authStatus}` : ''}`);
          parts.push(`候选 ${candidates}`);
          parts.push(`↑入库 ${ingested}`);
          if (dup > 0) parts.push(`重复 ${dup}`);
          if (fail > 0) parts.push(`失败 ${fail}`);
          out.summary = parts.join(' · ');
        }
      }
      // Summarize source-scoring output: count + paused + avg delta + top movers.
      if (bucket === 'source-scoring' && r.status === 'success' && r.output) {
        const o = typeof r.output === 'string' ? safeJsonParse(r.output) : r.output;
        const samples: Array<{ name: string; before: number; after: number; status: string }> =
          Array.isArray(o?.samples) ? o.samples : [];
        if (samples.length > 0) {
          const deltas = samples.map((s) => s.after - s.before);
          const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const paused = samples.filter((s) => s.status === 'paused').length;
          const blacklist = samples.filter((s) => s.status === 'blacklist').length;
          const movers = [...samples]
            .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
            .slice(0, 3)
            .map((s) => ({ name: s.name, before: s.before, after: s.after }));
          const parts: string[] = [`更新 ${samples.length} 个源`];
          parts.push(`平均 ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}`);
          if (paused > 0) parts.push(`${paused} 个被暂停`);
          if (blacklist > 0) parts.push(`${blacklist} 个进黑名单`);
          out.summary = parts.join(' · ');
          out.movers = movers;
        } else if (typeof o?.updated === 'number') {
          out.summary = `更新 ${o.updated} 个源`;
        }
      }
      if (!recentByAgent[bucket]) recentByAgent[bucket] = [];
      recentByAgent[bucket].push(out);
    }

    return { active, recent: recentByAgent };
  });
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
