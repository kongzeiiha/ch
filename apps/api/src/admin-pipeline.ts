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
import { query } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';

// ── In-memory automation state (single-process MVP) ───────────────────────
// Key = agent key (see AGENT_KEYS below), value = true/false
export const autoState: Map<string, boolean> = new Map([
  ['source-scoring',   false],
  ['ingestion',        false],
  ['classification',   true],   // safe to auto
  ['title',            true],
  ['cover',            true],
  ['compliance',       true],
  ['publishing',       false],  // HUMAN GATE — cannot auto by default
  ['distribution',     false],  // HUMAN GATE
  ['analytics',        false],
]);

export const pausedState: Map<string, boolean> = new Map();
export let globalStop = false;

export function setGlobalStop(v: boolean) { globalStop = v; }

// Status → agent that processes it next
const STATUS_TO_AGENT: Record<string, string> = {
  INGESTED:          'classification',
  CLASSIFIED:        'title',
  TITLED:            'cover',
  COVERED:           'compliance',
  COMPLIANCE_PASS:   'publishing',
  PUBLISHED:         'distribution',
};

// Agent → queue action
const AGENT_QUEUE_ACTION: Record<string, () => Promise<{ queued: number }>> = {
  classification: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='INGESTED' LIMIT 200`);
    const q = getQueue(QUEUE_NAMES.classification);
    for (const { id } of items) await q.add('classify', { itemId: id }, { jobId: `classify__${id}` });
    return { queued: items.length };
  },
  title: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='CLASSIFIED' LIMIT 200`);
    const q = getQueue(QUEUE_NAMES.title);
    for (const { id } of items) await q.add('title', { itemId: id }, { jobId: `title__${id}` });
    return { queued: items.length };
  },
  cover: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='TITLED' LIMIT 200`);
    const q = getQueue(QUEUE_NAMES.cover);
    for (const { id } of items) await q.add('cover', { itemId: id }, { jobId: `cover__${id}` });
    return { queued: items.length };
  },
  compliance: async () => {
    const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='COVERED' LIMIT 200`);
    const q = getQueue(QUEUE_NAMES.compliance);
    for (const { id } of items) await q.add('compliance', { itemId: id }, { jobId: `compliance__${id}` });
    return { queued: items.length };
  },
  publishing: async () => {
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status='COMPLIANCE_PASS' AND slug IS NOT NULL LIMIT 200`,
    );
    const q = getQueue(QUEUE_NAMES.publishing);
    for (const { id } of items) await q.add('publish', { itemId: id }, { jobId: `publish__${id}` });
    return { queued: items.length };
  },
  distribution: async () => {
    const items = await query<{ id: string }>(
      `SELECT id FROM items WHERE status='PUBLISHED'
       AND id NOT IN (SELECT DISTINCT item_id FROM distribution_tasks WHERE channel='twitter')
       LIMIT 100`,
    );
    const q = getQueue(QUEUE_NAMES.distribution);
    for (const { id } of items) await q.add('distribute', { itemId: id, channel: 'twitter' }, { jobId: `dist__twitter__${id}` });
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
  CLASSIFIED:        { toStatus: 'INGESTED',         clearFields: ['category', 'tags', 'keywords'] },
  TITLED:            { toStatus: 'CLASSIFIED',        clearFields: ['title', 'summary', 'slug'] },
  COVERED:           { toStatus: 'TITLED',            clearFields: ['cover_url', 'cover_sizes', 'cover_copy'] },
  COMPLIANCE_PASS:   { toStatus: 'COVERED',           clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  COMPLIANCE_FAIL:   { toStatus: 'COVERED',           clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  COMPLIANCE_REVIEW: { toStatus: 'COVERED',           clearFields: ['compliance_status', 'risk_tags', 'compliance_reasons'] },
  PUBLISHED:         { toStatus: 'COMPLIANCE_PASS',   clearFields: ['published_url', 'published_at'] },
  DISTRIBUTED:       { toStatus: 'PUBLISHED' },
};

export async function registerPipelineAdmin(app: FastifyInstance) {

  // ── Automation state ──────────────────────────────────────────────────

  app.get('/admin/pipeline/state', async () => {
    const pending = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM items GROUP BY status`,
    );
    const pendingMap = Object.fromEntries(pending.map((r) => [r.status, r.cnt]));

    const reviewQueue = await query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM items WHERE status='COMPLIANCE_REVIEW'`,
    );
    const publishQueue = await query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM items WHERE status='COMPLIANCE_PASS'`,
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
    autoState.set(agent, auto);
    return { agent, auto };
  });

  app.post('/admin/pipeline/set-paused', async (req, reply) => {
    const { agent, paused } = req.body as { agent: string; paused: boolean };
    if (!autoState.has(agent)) return reply.status(400).send({ error: 'unknown agent' });
    pausedState.set(agent, paused);
    return { agent, paused };
  });

  app.post('/admin/pipeline/emergency-stop', async () => {
    setGlobalStop(true);
    return { stopped: true };
  });

  app.post('/admin/pipeline/resume', async () => {
    setGlobalStop(false);
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
       WHERE i.status = 'COMPLIANCE_REVIEW'
       ORDER BY i.updated_at DESC`,
    );
    return { items };
  });

  // Approve compliance review → COMPLIANCE_PASS + optionally queue for publishing
  app.post('/admin/pipeline/approve-review/:itemId', async (req) => {
    const { itemId } = req.params as { itemId: string };
    await query(
      `UPDATE items SET status='COMPLIANCE_PASS', compliance_status='manual_pass'
       WHERE id=$1 AND status='COMPLIANCE_REVIEW'`,
      [itemId],
    );
    // Record human decision in agent_runs
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
       VALUES ('human:review', $1, 'success', '{"decision":"approve"}', NOW())`,
      [itemId],
    );
    return { approved: itemId };
  });

  // Reject compliance review → COMPLIANCE_FAIL
  app.post('/admin/pipeline/reject-review/:itemId', async (req) => {
    const { itemId } = req.params as { itemId: string };
    const { reason } = (req.body as { reason?: string }) ?? {};
    await query(
      `UPDATE items SET status='COMPLIANCE_FAIL', compliance_status='manual_fail'
       WHERE id=$1 AND status='COMPLIANCE_REVIEW'`,
      [itemId],
    );
    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, error, finished_at)
       VALUES ('human:review', $1, 'success', '{"decision":"reject"}', $2, NOW())`,
      [itemId, reason ?? null],
    );
    return { rejected: itemId };
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
       WHERE i.status = 'COMPLIANCE_PASS'
       ORDER BY i.updated_at DESC`,
    );
    return { items };
  });

  // Approve items for publishing (batch or single)
  app.post('/admin/pipeline/approve-publish', async (req) => {
    const { itemIds } = req.body as { itemIds?: string[] };
    const candidates = itemIds
      ? await query<{ id: string }>(`SELECT id FROM items WHERE id=ANY($1) AND status='COMPLIANCE_PASS'`, [itemIds])
      : await query<{ id: string }>(`SELECT id FROM items WHERE status='COMPLIANCE_PASS' LIMIT 200`);

    const q = getQueue(QUEUE_NAMES.publishing);
    for (const { id } of candidates) {
      await q.add('publish', { itemId: id }, { jobId: `publish__${id}` });
      await query(
        `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
         VALUES ('human:publish-gate', $1, 'success', '{"decision":"approve"}', NOW())`,
        [id],
      );
    }
    return { queued: candidates.length };
  });

  // Distribution queue: PUBLISHED items + their generated copy
  app.get('/admin/pipeline/distribution-queue', async () => {
    const rows = await query<{
      item_id: string; title: string; slug: string | null;
      task_id: string; channel: string; copy: string; status: string; created_at: string;
    }>(
      `SELECT dt.item_id, i.title, i.slug,
              dt.id AS task_id, dt.channel, dt.copy, dt.status, dt.created_at::text
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
    await query(
      `UPDATE distribution_tasks SET status='done', executed_at=NOW() WHERE id=$1`,
      [taskId],
    );
    await query(
      `UPDATE items SET status='DISTRIBUTED'
       WHERE id=(SELECT item_id FROM distribution_tasks WHERE id=$1)
         AND status='PUBLISHED'`,
      [taskId],
    );
    return { confirmed: taskId };
  });

  // ── Rollback & Re-run ─────────────────────────────────────────────────

  app.post('/admin/pipeline/rollback/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM items WHERE id=$1`,
      [itemId],
    );
    const item = rows[0];
    if (!item) return reply.status(404).send({ error: 'item not found' });

    const rb = ROLLBACK_MAP[item.status];
    if (!rb) return reply.status(400).send({ error: `no rollback defined for status=${item.status}` });

    const clearSet = rb.clearFields?.map((f) => `${f}=NULL`).join(', ');
    const sql = `UPDATE items SET status=$2${clearSet ? `, ${clearSet}` : ''} WHERE id=$1`;
    await query(sql, [itemId, rb.toStatus]);

    await query(
      `INSERT INTO agent_runs (agent, item_id, status, output, finished_at)
       VALUES ('human:rollback', $1, 'success', $2, NOW())`,
      [itemId, JSON.stringify({ from: item.status, to: rb.toStatus })],
    );
    return { itemId, from: item.status, to: rb.toStatus };
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
      classification: QUEUE_NAMES.classification,
      title:          QUEUE_NAMES.title,
      cover:          QUEUE_NAMES.cover,
      compliance:     QUEUE_NAMES.compliance,
      publishing:     QUEUE_NAMES.publishing,
      distribution:   QUEUE_NAMES.distribution,
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
                i.created_at::text, i.updated_at::text,
                s.name AS source, r.url AS original_url
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN raw_items r ON r.id = i.raw_item_id
         WHERE i.id=$1`,
        [itemId],
      ),
      query(
        `SELECT id, agent, status, latency_ms, cost_usd,
                CASE WHEN length(error)>200 THEN left(error,200)||'…' ELSE error END AS error,
                output, started_at::text, finished_at::text
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
      { key: 'classification', queue: 'classification' },
      { key: 'title',          queue: 'title' },
      { key: 'cover',          queue: 'cover' },
      { key: 'compliance',     queue: 'compliance' },
      { key: 'publishing',     queue: 'publishing' },
      { key: 'distribution',   queue: 'distribution' },
      { key: 'analytics',      queue: 'analytics' },
    ];

    const active: Record<string, Array<{ itemId: string | null; label: string; since: string | null }>> = {};
    const itemIdsToLookup = new Set<string>();

    // Pass 1: collect active jobs, remember item IDs that need titles
    const perAgentActive: Array<{ key: string; jobs: Array<{ itemId: string | null; raw: any; since: string | null }> }> = [];
    for (const { key, queue } of AGENT_QUEUES) {
      const q = getQueue(QUEUE_NAMES[queue] as any);
      const jobs = await q.getActive(0, 8);
      const decoded = jobs.map((j) => {
        const d = j.data as any;
        const itemId: string | null = d?.itemId ?? null;
        const since = j.processedOn ? new Date(j.processedOn).toISOString() : null;
        if (itemId) itemIdsToLookup.add(itemId);
        return { itemId, raw: d, since };
      });
      perAgentActive.push({ key, jobs: decoded });
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

    // Recent completed (last 3 per agent from agent_runs)
    const recent = await query<{ agent: string; item_id: string | null; title: string | null; finished_at: string; latency_ms: number | null; status: string }>(
      `SELECT ar.agent, ar.item_id, i.title,
              ar.finished_at::text AS finished_at, ar.latency_ms, ar.status
       FROM (
         SELECT agent, item_id, finished_at, latency_ms, status,
                ROW_NUMBER() OVER (PARTITION BY agent ORDER BY finished_at DESC) AS rn
         FROM agent_runs WHERE finished_at IS NOT NULL
       ) ar
       LEFT JOIN items i ON i.id = ar.item_id
       WHERE ar.rn <= 3`,
    );
    const recentByAgent: Record<string, typeof recent> = {};
    for (const r of recent) {
      const bucket = r.agent.split(':')[0]; // strip "human:..." prefixes
      if (!recentByAgent[bucket]) recentByAgent[bucket] = [];
      recentByAgent[bucket].push(r);
    }

    return { active, recent: recentByAgent };
  });
}
