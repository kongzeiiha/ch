import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const QUEUE_NAMES = {
  sourceScoring: 'source-scoring',
  ingestion: 'ingestion',
  classification: 'classification',
  title: 'title',
  cover: 'cover',
  compliance: 'compliance',
  publishing: 'publishing',
  distribution: 'distribution',
  analytics: 'analytics',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue<T = any>(name: QueueName): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

export interface WorkerOptions {
  concurrency?: number;
}

export function startWorker<T = any>(
  name: QueueName,
  processor: Processor<T>,
  opts: WorkerOptions = {},
): Worker<T> {
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: opts.concurrency ?? 4,
  });
  worker.on('failed', (job, err) => {
    console.error(`[${name}] job=${job?.id} failed: ${err.message}`);
  });
  worker.on('completed', (job) => {
    console.log(`[${name}] job=${job.id} done`);
  });
  return worker;
}

export async function closeAll(): Promise<void> {
  for (const q of queues.values()) await q.close();
  await connection.quit();
}

export async function pingRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const pong = await connection.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e?.message ?? String(e) };
  }
}

export interface QueueStats {
  name: QueueName;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  };
}

export async function getAllQueueStats(): Promise<QueueStats[]> {
  const out: QueueStats[] = [];
  for (const name of Object.values(QUEUE_NAMES) as QueueName[]) {
    const q = getQueue(name);
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    out.push({
      name,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      },
    });
  }
  return out;
}
