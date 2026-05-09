import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ch/db', () => ({
  query: vi.fn(),
  ITEM_STATUS: { INGESTED: 'ingested', CLASSIFIED: 'classified', TITLED: 'titled' },
}));
vi.mock('@ch/agents', () => {
  const addMock = vi.fn().mockResolvedValue(undefined);
  const queueMock = { add: addMock };
  return {
    getQueue: vi.fn(() => queueMock),
    QUEUE_NAMES: { cover: 'cover' },
    startWorker: vi.fn(),
    withRun: vi.fn(),
    permanent: vi.fn((...args: any[]) => {
      throw Object.assign(new Error(String(args[0])), { permanent: true });
    }),
  };
});
vi.mock('../workers/classify-title/categorize.js', () => ({
  classify: vi.fn(),
  classifyByRules: vi.fn(() => ({ category: 'tech', tags: ['ai'], keywords: ['llm'] })),
}));
vi.mock('../workers/classify-title/generate.js', () => ({
  generateTitle: vi.fn(),
  generateTitleByRules: vi.fn(() => ({
    candidates: ['Rule Title'],
    best_index: 0,
    summary: 'rule summary',
  })),
}));
vi.mock('../workers/classify-title/slug.js', () => ({
  makeUniqueSlug: vi.fn(async (title: string) => title.toLowerCase().replace(/\s+/g, '-')),
}));

import { query } from '@ch/db';
import { getQueue } from '@ch/agents';
import { classifyTitleOne } from '../workers/classify-title/index.js';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockGetQueue = getQueue as ReturnType<typeof vi.fn>;

const LONG_CONTENT = 'word '.repeat(20); // 100 chars, passes >= 40 check

const INGESTED_ITEM = {
  id: 'item-1',
  status: 'ingested',
  title: 'Original Title',
  content: LONG_CONTENT,
  category: null,
  tags: [],
  keywords: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLASSIFICATION_SKIP_LLM = '1';
  process.env.TITLE_SKIP_LLM = '1';
});

describe('classifyTitleOne', () => {
  it('returns skipped when item not found', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await classifyTitleOne('missing');
    expect(result).toMatchObject({ skipped: true, reason: 'item not found' });
  });

  it('returns skipped when status is not processable', async () => {
    mockQuery.mockResolvedValue([{ ...INGESTED_ITEM, status: 'published' }]);
    const result = await classifyTitleOne('item-1');
    expect(result).toMatchObject({ skipped: true, status: 'published' });
  });

  it('throws (via permanent) when content too short', async () => {
    mockQuery.mockResolvedValue([{ ...INGESTED_ITEM, content: 'hi', status: 'ingested' }]);
    await expect(classifyTitleOne('item-1')).rejects.toThrow('content too short');
  });

  it('runs classify rules + title rules for INGESTED item and enqueues cover job', async () => {
    mockQuery
      .mockResolvedValueOnce([INGESTED_ITEM]) // SELECT
      .mockResolvedValue([]); // UPDATE calls

    const result = await classifyTitleOne('item-1') as any;
    expect(result.skipped).toBeUndefined();
    expect(result.category).toBe('tech');
    expect(result.title).toBe('Rule Title');
    expect(result.slug).toBe('rule-title');

    // SELECT + classify UPDATE + title UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const addSpy = mockGetQueue.mock.results[0].value.add;
    expect(addSpy).toHaveBeenCalledWith(
      'render',
      { itemId: 'item-1' },
      { jobId: 'cover__item-1', removeOnComplete: true },
    );
  });

  it('skips classify step for CLASSIFIED backlog item and only runs title UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        ...INGESTED_ITEM,
        status: 'classified',
        category: 'science',
        tags: ['research'],
        keywords: ['paper'],
      }])
      .mockResolvedValue([]);

    const result = await classifyTitleOne('item-1') as any;
    expect(result.category).toBe('science');
    // Only SELECT + title UPDATE (no classify UPDATE)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
