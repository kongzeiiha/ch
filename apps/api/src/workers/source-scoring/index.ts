import type { Job } from 'bullmq';
import { QUEUE_NAMES, startWorker, withRun } from '@ch/agents';
import { scoreAllSources } from './scorer.js';

export interface SourceScoringJob {
  kind?: 'run';
}

export function startSourceScoringWorker() {
  return startWorker<SourceScoringJob>(
    QUEUE_NAMES.sourceScoring,
    async (_job: Job<SourceScoringJob>) => {
      return withRun({ agent: 'source-scoring' }, async () => {
        const out = await scoreAllSources();
        return { output: out };
      });
    },
    { concurrency: 1 },
  );
}
