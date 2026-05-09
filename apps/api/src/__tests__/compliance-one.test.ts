import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ch/db', () => ({
  query: vi.fn(),
  ITEM_STATUS: {
    COVERED: 'covered',
    COMPLIANCE_PASS: 'compliance_pass',
    COMPLIANCE_REVIEW: 'compliance_review',
    COMPLIANCE_FAIL: 'compliance_fail',
  },
}));
vi.mock('@ch/agents', () => {
  const addMock = vi.fn().mockResolvedValue(undefined);
  const queueMock = { add: addMock };
  return {
    getQueue: vi.fn(() => queueMock),
    QUEUE_NAMES: { publishing: 'publishing' },
    startWorker: vi.fn(),
    withRun: vi.fn(),
    isTransient: vi.fn(() => false),
    permanent: vi.fn((...args: any[]) => {
      throw Object.assign(new Error(String(args[0])), { permanent: true });
    }),
  };
});
vi.mock('../workers/compliance/blacklist.js', () => ({
  runBlacklist: vi.fn(() => []),
}));
vi.mock('../workers/compliance/score.js', () => ({
  scoreCompliance: vi.fn(),
}));
vi.mock('../workers/compliance/decide.js', () => ({
  decide: vi.fn(() => ({
    status: 'compliance_pass',
    risk_tags: [],
    trigger: 'pass',
    maxScore: 0,
  })),
}));

import { query } from '@ch/db';
import { getQueue } from '@ch/agents';
import { runBlacklist } from '../workers/compliance/blacklist.js';
import { decide } from '../workers/compliance/decide.js';
import { complianceOne } from '../workers/compliance/index.js';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockGetQueue = getQueue as ReturnType<typeof vi.fn>;
const mockRunBlacklist = runBlacklist as ReturnType<typeof vi.fn>;
const mockDecide = decide as ReturnType<typeof vi.fn>;

const COVERED_ITEM = {
  id: 'item-1',
  status: 'covered',
  title: 'Test Article',
  content: 'This is article content about technology.',
  category: 'tech',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COMPLIANCE_SKIP_LLM = '1';
  mockDecide.mockReturnValue({
    status: 'compliance_pass',
    risk_tags: [],
    trigger: 'pass',
    maxScore: 0,
  });
});

describe('complianceOne', () => {
  it('returns skipped when item not found', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await complianceOne('missing');
    expect(result).toMatchObject({ skipped: true, reason: 'item not found' });
  });

  it('returns skipped when status is not in compliance pipeline', async () => {
    mockQuery.mockResolvedValue([{ ...COVERED_ITEM, status: 'ingested' }]);
    const result = await complianceOne('item-1');
    expect(result).toMatchObject({ skipped: true, status: 'ingested' });
  });

  it('passes item and enqueues publish job when decide returns PASS', async () => {
    mockQuery
      .mockResolvedValueOnce([COVERED_ITEM])
      .mockResolvedValue([]);

    const result = await complianceOne('item-1') as any;
    expect(result.decision).toBe('compliance_pass');

    const addSpy = mockGetQueue.mock.results[0].value.add;
    expect(addSpy).toHaveBeenCalledWith(
      'publish',
      { itemId: 'item-1' },
      { jobId: 'publish__item-1', removeOnComplete: true },
    );
  });

  it('does not enqueue publish job when decide returns REVIEW', async () => {
    mockDecide.mockReturnValue({
      status: 'compliance_review',
      risk_tags: ['llm_unavailable'],
      trigger: 'llm_review',
      maxScore: -1,
    });
    mockQuery
      .mockResolvedValueOnce([COVERED_ITEM])
      .mockResolvedValue([]);

    const result = await complianceOne('item-1') as any;
    expect(result.decision).toBe('compliance_review');
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  it('calls runBlacklist and passes hits to decide', async () => {
    const hit = { category: '暴力恐怖', pattern: 'bomb', matched: 'bomb' };
    mockRunBlacklist.mockReturnValue([hit]);
    mockDecide.mockReturnValue({
      status: 'compliance_fail',
      risk_tags: ['暴力恐怖'],
      trigger: 'blacklist',
      maxScore: -1,
    });
    mockQuery
      .mockResolvedValueOnce([COVERED_ITEM])
      .mockResolvedValue([]);

    const result = await complianceOne('item-1') as any;
    expect(result.decision).toBe('compliance_fail');
    expect(result.blacklistHits).toBe(1);
    // decide is called with the hits and undefined (no LLM risk when blacklist fires)
    expect(mockDecide).toHaveBeenCalledWith([hit], undefined);
  });
});
