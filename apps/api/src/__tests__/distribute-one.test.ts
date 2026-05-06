import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ch/db', () => ({
  query: vi.fn(),
  ITEM_STATUS: { PUBLISHED: 'published', DISTRIBUTED: 'distributed' },
}));
vi.mock('@ch/agents', () => ({
  QUEUE_NAMES: { distribution: 'distribution' },
  startWorker: vi.fn(),
  withRun: vi.fn(),
  permanent: vi.fn((...args: any[]) => {
    throw Object.assign(new Error(String(args[0])), { permanent: true });
  }),
}));
vi.mock('../workers/distribution/rewrite.js', () => ({
  rewriteForTwitter: vi.fn(async () => ({
    copy: 'Great article! Check it out at https://example.com',
    model: 'sonnet',
    costUsd: 0.001,
  })),
}));

import { query } from '@ch/db';
import { rewriteForTwitter } from '../workers/distribution/rewrite.js';
import { distributeOne } from '../workers/distribution/index.js';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockRewrite = rewriteForTwitter as ReturnType<typeof vi.fn>;

const PUBLISHED_ITEM = {
  id: 'item-1',
  title: 'Tech Breakthrough in AI',
  summary: 'Researchers discover new model architecture.',
  category: 'tech',
  tags: ['ai', 'research'],
  published_url: 'https://example.com/article',
  slug: 'tech-breakthrough-in-ai',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('distributeOne', () => {
  it('returns skipped when item not found or not published', async () => {
    mockQuery.mockResolvedValueOnce([]); // no item
    const result = await distributeOne('missing');
    expect(result).toMatchObject({ skipped: true, reason: 'item not found or not published' });
  });

  it('returns skipped when item already distributed to channel', async () => {
    mockQuery
      .mockResolvedValueOnce([PUBLISHED_ITEM]) // item found
      .mockResolvedValueOnce([{ id: 'dt-1' }]); // existing distribution_task

    const result = await distributeOne('item-1', 'twitter');
    expect(result).toMatchObject({ skipped: true, reason: 'already distributed' });
  });

  it('throws (via permanent) when published_url is missing', async () => {
    mockQuery.mockResolvedValueOnce([{ ...PUBLISHED_ITEM, published_url: null }]);
    await expect(distributeOne('item-1')).rejects.toThrow('no published_url');
  });

  it('rewrites content, inserts distribution_task, updates item status, and returns result', async () => {
    mockQuery
      .mockResolvedValueOnce([PUBLISHED_ITEM]) // SELECT item
      .mockResolvedValueOnce([])               // SELECT existing (none)
      .mockResolvedValue([]);                  // INSERT + UPDATE

    const result = await distributeOne('item-1', 'twitter') as any;
    expect(result.channel).toBe('twitter');
    expect(result.copy).toContain('https://example.com');
    expect(result.model).toBe('sonnet');

    // INSERT into distribution_tasks
    const insertCall = mockQuery.mock.calls[2][0] as string;
    expect(insertCall).toContain('INSERT INTO distribution_tasks');

    // UPDATE items status = distributed
    const updateCall = mockQuery.mock.calls[3][0] as string;
    expect(updateCall).toContain('UPDATE items');
  });

  it('passes item fields to rewriteForTwitter', async () => {
    mockQuery
      .mockResolvedValueOnce([PUBLISHED_ITEM])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);

    await distributeOne('item-1', 'twitter');
    expect(mockRewrite).toHaveBeenCalledWith(
      expect.objectContaining({
        title: PUBLISHED_ITEM.title,
        published_url: PUBLISHED_ITEM.published_url,
      }),
    );
  });
});
