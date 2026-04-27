import type { Job } from 'bullmq';
import { QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { pullAnalyticsYesterday } from './ga4.js';
import { generateWeeklyReport } from './report.js';

export interface AnalyticsJob {
  kind: 'pull' | 'report';
}

export function startAnalyticsWorker() {
  return startWorker<AnalyticsJob>(
    QUEUE_NAMES.analytics,
    async (job: Job<AnalyticsJob>) => {
      const { kind } = job.data;

      if (kind === 'report') {
        return withRun({ agent: 'analytics' }, async () => {
          const report = await generateWeeklyReport();
          return { output: { report } };
        });
      }

      // default: pull
      return withRun({ agent: 'analytics' }, async () => {
        const out = await pullAnalyticsYesterday();
        return { output: out };
      });
    },
    { concurrency: 1 },
  );
}
