import { getQueue, QUEUE_NAMES } from '@ch/agents';
import type { IngestionJob } from './workers/ingestion/index.js';
import type { SourceScoringJob } from './workers/source-scoring/index.js';
import type { AnalyticsJob } from './workers/analytics/index.js';

/**
 * Register BullMQ repeatable jobs. Idempotent: rerunning on boot replaces
 * the existing schedule by jobId rather than duplicating it.
 */
export async function setupScheduler(): Promise<void> {
  const ingestion = getQueue<IngestionJob>(QUEUE_NAMES.ingestion);
  await ingestion.add(
    'fanout',
    { kind: 'fanout' },
    {
      repeat: { pattern: process.env.INGESTION_CRON ?? '0 * * * *' },
      jobId: 'ingestion-fanout-cron',
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );

  const scoring = getQueue<SourceScoringJob>(QUEUE_NAMES.sourceScoring);
  await scoring.add(
    'run',
    { kind: 'run' },
    {
      repeat: { pattern: process.env.SOURCE_SCORING_CRON ?? '15 3 * * *' }, // daily 03:15
      jobId: 'source-scoring-cron',
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );

  // GA4 T+1 pull — runs at 02:00 UTC so yesterday's data is settled
  const analytics = getQueue<AnalyticsJob>(QUEUE_NAMES.analytics);
  await analytics.add(
    'pull',
    { kind: 'pull' },
    {
      repeat: { pattern: process.env.ANALYTICS_CRON ?? '0 2 * * *' },
      jobId: 'analytics-daily-cron',
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}
