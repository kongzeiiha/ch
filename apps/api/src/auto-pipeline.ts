/**
 * Auto-pipeline engine.
 * Polls every AUTO_PIPELINE_INTERVAL_MS and triggers batch actions
 * for agents that are in auto mode and not paused.
 *
 * Human gates (publishing, distribution) are NEVER triggered automatically
 * even if auto mode is explicitly set — they require human approval via the UI.
 */

import { query } from '@ch/db';
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
    countSql: `SELECT COUNT(*)::int AS cnt FROM sources WHERE status='active'`,
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.sourceScoring).add('score', {}, { jobId: `score__auto__${Date.now()}` });
      return 1;
    },
  },
  {
    agent: 'ingestion',
    countSql: `SELECT COUNT(*)::int AS cnt FROM sources WHERE status='active'`,
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.ingestion).add('fanout', { kind: 'fanout' }, { jobId: `fanout__auto__${Date.now()}` });
      return 1;
    },
  },
  {
    agent: 'classification',
    countSql: `SELECT COUNT(*)::int AS cnt FROM items WHERE status='INGESTED'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='INGESTED' LIMIT 200`);
      const q = getQueue(QUEUE_NAMES.classification);
      for (const { id } of items) await q.add('classify', { itemId: id }, { jobId: `classify__${id}` });
      return items.length;
    },
  },
  {
    agent: 'title',
    countSql: `SELECT COUNT(*)::int AS cnt FROM items WHERE status='CLASSIFIED'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='CLASSIFIED' LIMIT 200`);
      const q = getQueue(QUEUE_NAMES.title);
      for (const { id } of items) await q.add('title', { itemId: id }, { jobId: `title__${id}` });
      return items.length;
    },
  },
  {
    agent: 'cover',
    countSql: `SELECT COUNT(*)::int AS cnt FROM items WHERE status='TITLED'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='TITLED' LIMIT 200`);
      const q = getQueue(QUEUE_NAMES.cover);
      for (const { id } of items) await q.add('cover', { itemId: id }, { jobId: `cover__${id}` });
      return items.length;
    },
  },
  {
    agent: 'compliance',
    countSql: `SELECT COUNT(*)::int AS cnt FROM items WHERE status='COVERED'`,
    triggerFn: async () => {
      const items = await query<{ id: string }>(`SELECT id FROM items WHERE status='COVERED' LIMIT 200`);
      const q = getQueue(QUEUE_NAMES.compliance);
      for (const { id } of items) await q.add('compliance', { itemId: id }, { jobId: `compliance__${id}` });
      return items.length;
    },
  },
  {
    agent: 'analytics',
    countSql: `SELECT 1::int AS cnt`, // always check — just schedule if auto
    triggerFn: async () => {
      await getQueue(QUEUE_NAMES.analytics).add('analytics', { kind: 'pull' }, { jobId: `analytics__auto__${Date.now()}` });
      return 1;
    },
  },
];

let _timer: NodeJS.Timeout | null = null;

async function tick() {
  if (globalStop) return;

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
