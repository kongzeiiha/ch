import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@ch/db', () => ({ query: vi.fn() }));

import { query } from '@ch/db';
import { withRun, setSpanProvider } from '../runner.js';

const mockQuery = query as ReturnType<typeof vi.fn>;

describe('withRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    setSpanProvider(undefined as any);
  });

  afterEach(() => {
    setSpanProvider(undefined as any);
  });

  it('inserts a running row and updates to success on completion', async () => {
    const result = await withRun({ agent: 'test-agent' }, async () => ({
      output: { done: true },
    }));

    expect(result).toEqual({ done: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertSql = mockQuery.mock.calls[0][0] as string;
    expect(insertSql).toContain("'running'");
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("'success'");
  });

  it('updates to failed and rethrows on error', async () => {
    const boom = new Error('worker exploded');
    await expect(
      withRun({ agent: 'test-agent' }, async () => { throw boom; }),
    ).rejects.toThrow('worker exploded');

    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("'failed'");
  });

  it('writes model, cost, usage to the success row', async () => {
    await withRun({ agent: 'llm-agent' }, async () => ({
      output: null,
      model: 'llama-3.3-70b',
      cost: 0.0042,
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const updateArgs = mockQuery.mock.calls[1][1] as any[];
    // model is $3, cost is $7
    expect(updateArgs[2]).toBe('llama-3.3-70b');
    expect(updateArgs[6]).toBe(0.0042);
    expect(updateArgs[3]).toBe(100); // input_tokens
    expect(updateArgs[4]).toBe(50);  // output_tokens
  });

  it('calls the span provider with agent name and item.id', async () => {
    const calls: Array<{ name: string; attrs: Record<string, string> }> = [];
    setSpanProvider(async (name, attrs, fn) => {
      calls.push({ name, attrs });
      return fn();
    });

    await withRun({ agent: 'classify-title', itemId: 'item-abc' }, async () => ({
      output: 'ok',
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('classify-title');
    expect(calls[0].attrs['agent.name']).toBe('classify-title');
    expect(calls[0].attrs['item.id']).toBe('item-abc');
  });

  it('still marks run as failed if span provider throws', async () => {
    setSpanProvider(async () => { throw new Error('sentry down'); });

    await expect(
      withRun({ agent: 'test' }, async () => ({ output: null })),
    ).rejects.toThrow('sentry down');

    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("'failed'");
  });
});
