/**
 * Auto-pipeline engine.
 * Polls every AUTO_PIPELINE_INTERVAL_MS and triggers batch actions
 * for agents that are in auto mode and not paused.
 *
 * Human gates (publishing, distribution) are NEVER triggered automatically
 * even if auto mode is explicitly set — they require human approval via the UI.
 */

import { query, ITEM_STATUS as IS } from '@ch/db';
import { getQueue, QUEUE_NAMES } from '@ch/agents';
import { autoState, pausedState, globalStop } from './admin-pipeline.js';
import { captureException } from './sentry.js';

const INTERVAL_MS = Number(process.env.AUTO_PIPELINE_INTERVAL_MS ?? 15_000);

// These agents are protected by human gates and can never auto-trigger
const HARD_HUMAN_GATES = new Set(['publishing', 'distribution']);

interface StageCheck {
  agent: string;
  countSql: string;
  triggerFn: () => Promise<number>;
}

const STAGES: StageCheck[] = [
  {
    agent: 'source-scoring',
    countSql: `SELECT COUNT(*) AS cnt FROM sources WHERE status='active'`,
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.sourceScoring).add('score', {}, { jobId: 'score__auto' });
      return 1;
    },
  },
  {
    agent: 'ingestion',
    countSql: `SELECT COUNT(*) AS cnt FROM sources WHERE status='active'`,
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.ingestion).add('fanout', { kind: 'fanout' }, { jobId: 'fanout__auto' });
      return 1;
    },
  },
  {
    agent: 'classify-title',
    countSql: `SELECT COUNT(*) AS cnt FROM items WHERE status IN ('${IS.INGESTED}','${IS.CLASSIFIED}')`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(
        `SELECT id FROM items WHERE status = ANY($1::text[]) LIMIT 200`,
        [[IS.INGESTED, IS.CLASSIFIED]],
      );
      if (items.length === 0) return 0;
      await getQueue(QUEUE_NAMES.classifyTitle).addBulk(
        items.map(({ id }) => ({ name: 'classify-title', data: { itemId: id }, opts: { jobId: `classify-title__${id}` } })),
      );
      return items.length;
    },
  },
  {
    agent: 'cover',
    countSql: `SELECT COUNT(*) AS cnt FROM items WHERE status='${IS.TITLED}'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1 LIMIT 200`, [IS.TITLED]);
      if (items.length === 0) return 0;
      await getQueue(QUEUE_NAMES.cover).addBulk(
        items.map(({ id }) => ({ name: 'cover', data: { itemId: id }, opts: { jobId: `cover__${id}` } })),
      );
      return items.length;
    },
  },
  {
    agent: 'compliance',
    countSql: `SELECT COUNT(*) AS cnt FROM items WHERE status='${IS.COVERED}'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status = $1 LIMIT 200`, [IS.COVERED]);
      if (items.length === 0) return 0;
      await getQueue(QUEUE_NAMES.compliance).addBulk(
        items.map(({ id }) => ({ name: 'compliance', data: { itemId: id }, opts: { jobId: `compliance__${id}` } })),
      );
      return items.length;
    },
  },
  {
    agent: 'analytics',
    countSql: `SELECT 1 AS cnt`, // always check — just schedule if auto
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.analytics).add('analytics', { kind: 'pull' }, { jobId: `analytics__auto__${Date.now()}` });
      return 1;
    },
  },
];

let _timer: NodeJS.Timeout | null = null;
let _inFlight = false;

async function tick() {
  if (globalStop) return;
  // Skip if previous tick is still running. A loaded tick walks 8 queues and
  // hits MySQL several times — under load it can exceed INTERVAL_MS and
  // overlap with itself, double-queuing the same items into BullMQ.
  if (_inFlight) return;
  _inFlight = true;
  try {
    await runStages();
  } finally {
    _inFlight = false;
  }
}

async function runStages() {
  for (const stage of STAGES) {
    if (HARD_HUMAN_GATES.has(stage.agent)) continue;
    if (!autoState.get(stage.agent)) continue;
    if (pausedState.get(stage.agent)) continue;

    try {
      const rows = await query<{ cnt: number }>(stage.countSql);
      const cnt = rows[0]?.cnt ?? 0;
      if (cnt === 0) continue;

      // Skip if there are already active/waiting jobs for this queue
      const qname = (QUEUE_NAMES as Record<string, string>)[
        stage.agent.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      ];
      if (qname) {
        const q = getQueue(qname as any);
        const counts = await q.getJobCounts('waiting', 'active');
        const busy = (counts.waiting ?? 0) + (counts.active ?? 0);
        if (busy >= 10) continue; // already has enough work queued
      }

      const queued = await stage.triggerFn();
      if (queued > 0) {
        console.info(`[auto-pipeline] ${stage.agent} → queued ${queued} (pending=${cnt})`);
      }
    } catch (e) {
      captureException(e, { context: 'auto-pipeline', agent: stage.agent });
    }
  }
}

export function startAutoPipeline() {
  if (_timer) return;
  _timer = setInterval(tick, INTERVAL_MS);
  console.info(`[auto-pipeline] started, interval=${INTERVAL_MS}ms`);
}

export function stopAutoPipeline() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
