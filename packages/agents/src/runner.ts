import { query } from '@ch/db';
import { randomUUID } from 'node:crypto';

export interface RunOptions {
  agent: string;
  itemId?: string | null;
  inputHash?: string | null;
}

export interface RunResult<T> {
  output: T;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
  cost?: number;
}

/**
 * Wrap an agent step so every invocation writes an `agent_runs` row with
 * timing, tokens, cost, status, and error. Makes debugging and cost
 * accounting uniform across all 9 agents.
 */
export async function withRun<T>(
  opts: RunOptions,
  fn: () => Promise<RunResult<T>>,
): Promise<T> {
  const id = randomUUID();
  const started = Date.now();
  await query(
    `INSERT INTO agent_runs (id, agent, item_id, input_hash, status)
     VALUES ($1, $2, $3, $4, 'running')`,
    [id, opts.agent, opts.itemId ?? null, opts.inputHash ?? null],
  );

  try {
    const res = await fn();
    await query(
      `UPDATE agent_runs SET
         status            = 'success',
         output            = $2,
         model             = $3,
         input_tokens      = $4,
         output_tokens     = $5,
         cache_read_tokens = $6,
         cost_usd          = $7,
         latency_ms        = $8,
         finished_at       = NOW()
       WHERE id = $1`,
      [
        id,
        JSON.stringify(res.output ?? null),
        res.model ?? null,
        res.usage?.input_tokens ?? null,
        res.usage?.output_tokens ?? null,
        res.usage?.cache_read_input_tokens ?? null,
        res.cost ?? null,
        Date.now() - started,
      ],
    );
    return res.output;
  } catch (e: any) {
    await query(
      `UPDATE agent_runs SET
         status      = 'failed',
         error       = $2,
         latency_ms  = $3,
         finished_at = NOW()
       WHERE id = $1`,
      [id, String(e?.message ?? e).slice(0, 2000), Date.now() - started],
    );
    throw e;
  }
}
