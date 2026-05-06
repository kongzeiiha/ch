import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be declared before any imports that pull in the mocked module ──
vi.mock('@ch/db', () => ({ query: vi.fn() }));
vi.mock('@ch/agents', () => {
  const addMock = vi.fn().mockResolvedValue(undefined);
  const queueMock = { add: addMock };
  return {
    getQueue: vi.fn(() => queueMock),
    QUEUE_NAMES: { classifyTitle: 'classify-title' },
    withRun: vi.fn(),
  };
});
vi.mock('../workers/ingestion/adapters/index.js', () => {
  class AdapterAuthError extends Error {
    constructor(public status: number, public reason: string) {
      super(reason);
      this.name = 'AdapterAuthError';
    }
  }
  return { adapterFor: vi.fn(), AdapterAuthError };
});
vi.mock('../workers/ingestion/dedupe.js', () => ({
  dedupeKey: vi.fn((_platform: string, id: string) => `key:${id}`),
  normalizeForHash: vi.fn((s: string) => s),
  sha256: vi.fn((s: string) => `sha:${s}`),
  seenDedupeKeys: vi.fn(async () => new Set<string>()),
  seenContentHashes: vi.fn(async () => new Set<string>()),
  loadSimhashes: vi.fn(async () => []),
  findNearestSimhash: vi.fn(() => null),
}));
vi.mock('../workers/ingestion/simhash.js', () => ({
  simhash: vi.fn(() => BigInt(42)),
}));
vi.mock('../workers/ingestion/persist.js', () => ({
  persistIngested: vi.fn(async () => ({ rawItemId: 'raw-1', itemId: 'item-1' })),
}));

import { query } from '@ch/db';
import { adapterFor, AdapterAuthError } from '../workers/ingestion/adapters/index.js';
import { seenDedupeKeys, seenContentHashes, dedupeKey } from '../workers/ingestion/dedupe.js';
import { persistIngested } from '../workers/ingestion/persist.js';
import { ingestSource } from '../workers/ingestion/index.js';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockAdapterFor = adapterFor as ReturnType<typeof vi.fn>;
const mockSeenDedupeKeys = seenDedupeKeys as ReturnType<typeof vi.fn>;
const mockSeenContentHashes = seenContentHashes as ReturnType<typeof vi.fn>;
const mockDedupeKey = dedupeKey as ReturnType<typeof vi.fn>;
const mockPersistIngested = persistIngested as ReturnType<typeof vi.fn>;

const SOURCE = { id: 'src-1', platform: 'rss', external_id: 'feed', name: 'Test', url: 'http://x.com', config: {}, credential_id: null };
const longText = 'word '.repeat(60); // 300 chars, passes the >= 20 check

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([SOURCE]);
  mockDedupeKey.mockImplementation((_p: string, id: string) => `key:${id}`);
});

describe('ingestSource', () => {
  it('throws when source not found', async () => {
    mockQuery.mockResolvedValueOnce([]); // no source
    await expect(ingestSource('missing')).rejects.toThrow('not found or inactive');
  });

  it('returns authFail stats when adapter throws AdapterAuthError', async () => {
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new (AdapterAuthError as any)(401, 'expired')),
    });
    mockSeenDedupeKeys.mockResolvedValue(new Set());
    mockSeenContentHashes.mockResolvedValue(new Set());

    const stats = await ingestSource('src-1');
    expect(stats.authFail).toBe(true);
    expect(stats.authStatus).toBe(401);
    expect(stats.candidates).toBe(0);
    expect(stats.ingested).toBe(0);
  });

  it('counts dupUrl when dedupe key already seen', async () => {
    const knownKey = 'key:old-item';
    mockSeenDedupeKeys.mockResolvedValue(new Set([knownKey]));
    mockDedupeKey.mockReturnValue(knownKey);
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockResolvedValue([
        { externalId: 'old-item', url: 'http://x.com/1', text: longText },
      ]),
    });
    mockSeenContentHashes.mockResolvedValue(new Set());

    const stats = await ingestSource('src-1');
    expect(stats.dupUrl).toBe(1);
    expect(stats.ingested).toBe(0);
  });

  it('counts dupContent when content hash already seen', async () => {
    mockSeenDedupeKeys.mockResolvedValue(new Set());
    const hash = 'sha:' + longText;
    mockSeenContentHashes.mockResolvedValue(new Set([hash]));
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockResolvedValue([
        { externalId: 'dup-content', url: 'http://x.com/2', text: longText },
      ]),
    });

    const stats = await ingestSource('src-1');
    expect(stats.dupContent).toBe(1);
    expect(stats.ingested).toBe(0);
  });

  it('persists a new item and enqueues classify-title', async () => {
    mockSeenDedupeKeys.mockResolvedValue(new Set());
    mockSeenContentHashes.mockResolvedValue(new Set());
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockResolvedValue([
        { externalId: 'new-item', url: 'http://x.com/3', text: longText, skipSimhash: true },
      ]),
    });

    const stats = await ingestSource('src-1');
    expect(stats.ingested).toBe(1);
    expect(mockPersistIngested).toHaveBeenCalledOnce();
    const { getQueue } = await import('@ch/agents');
    const queueAddSpy = (getQueue as ReturnType<typeof vi.fn>).mock.results[0].value.add;
    expect(queueAddSpy).toHaveBeenCalledWith(
      'classify-title',
      { itemId: 'item-1' },
      { jobId: 'classify-title__item-1' },
    );
  });

  it('counts cleanFail when no html and text too short', async () => {
    mockSeenDedupeKeys.mockResolvedValue(new Set());
    mockSeenContentHashes.mockResolvedValue(new Set());
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockResolvedValue([
        { externalId: 'short', url: 'http://x.com/4', text: 'hi' }, // < 20 chars, no html
      ]),
    });

    const stats = await ingestSource('src-1');
    expect(stats.cleanFail).toBe(1);
    expect(stats.ingested).toBe(0);
  });

  it('combines dup and new correctly across a mixed batch', async () => {
    // dedupeKey uses default impl: (_p, id) => `key:${id}`
    // 'key:existing' is pre-seeded as known so it will be a dupUrl
    mockSeenDedupeKeys.mockResolvedValue(new Set(['key:existing']));
    mockSeenContentHashes.mockResolvedValue(new Set());
    mockAdapterFor.mockReturnValue({
      fetch: vi.fn().mockResolvedValue([
        { externalId: 'existing', url: 'http://x.com/a', text: longText, skipSimhash: true },
        { externalId: 'fresh',    url: 'http://x.com/b', text: longText, skipSimhash: true },
      ]),
    });

    const stats = await ingestSource('src-1');
    expect(stats.candidates).toBe(2);
    expect(stats.dupUrl).toBe(1);
    expect(stats.ingested).toBe(1);
  });
});
