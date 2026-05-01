import { startWorker, QUEUE_NAMES, type QueueName } from '@ch/agents';
import type { Worker } from 'bullmq';
import { startIngestionWorker } from './ingestion/index.js';
import { startClassifyTitleWorker } from './classify-title/index.js';
import { startCoverWorker } from './cover/index.js';
import { startComplianceWorker } from './compliance/index.js';
import { startPublishingWorker } from './publishing/index.js';
import { startSourceScoringWorker } from './source-scoring/index.js';
import { startDistributionWorker } from './distribution/index.js';
import { startAnalyticsWorker } from './analytics/index.js';
import { startCredentialRefreshWorker } from './credential-refresh/index.js';

/**
 * Each real Agent lives in its own folder and exports a `start*Worker()`.
 * The rest stay as boot-time stubs until their day on the sprint plan.
 */
const REAL_WORKERS: Record<string, () => Worker> = {
  [QUEUE_NAMES.ingestion]: startIngestionWorker,
  [QUEUE_NAMES.classifyTitle]: startClassifyTitleWorker,
  [QUEUE_NAMES.cover]: startCoverWorker,
  [QUEUE_NAMES.compliance]: startComplianceWorker,
  [QUEUE_NAMES.publishing]: startPublishingWorker,
  [QUEUE_NAMES.sourceScoring]: startSourceScoringWorker,
  [QUEUE_NAMES.distribution]: startDistributionWorker,
  [QUEUE_NAMES.analytics]: startAnalyticsWorker,
  [QUEUE_NAMES.credentialRefresh]: startCredentialRefreshWorker,
};

export function startWorkers(): Worker[] {
  const workers: Worker[] = [];

  for (const name of Object.values(QUEUE_NAMES) as QueueName[]) {
    const real = REAL_WORKERS[name];
    if (real) {
      workers.push(real());
      continue;
    }
    workers.push(
      startWorker(
        name,
        async (job) => {
          console.log(`[${name}] stub job=${job.id}`, job.data);
          return { ok: true, stub: true };
        },
        { concurrency: 2 },
      ),
    );
  }

  return workers;
}
