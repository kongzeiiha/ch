import { describe, it, expect, vi } from 'vitest';

// Mock heavy server-side deps so the module can be imported in isolation.
vi.mock('@ch/db', () => ({ query: vi.fn() }));
vi.mock('@ch/agents', () => ({ getQueue: vi.fn(), QUEUE_NAMES: {} }));
vi.mock('../workers/ingestion/index.js', () => ({ ingestSource: vi.fn() }));
vi.mock('../op-log.js', () => ({ logOperation: vi.fn() }));

const { validateSourceConfig } = await import('../admin.js');

describe('validateSourceConfig', () => {
  // ----- rss -----
  describe('rss', () => {
    it('accepts valid feed_url', () => {
      expect(validateSourceConfig('rss', { feed_url: 'https://example.com/feed.xml' })).toBeNull();
    });
    it('rejects missing feed_url', () => {
      expect(validateSourceConfig('rss', {})).toMatch(/feed_url/);
    });
    it('rejects non-http feed_url', () => {
      expect(validateSourceConfig('rss', { feed_url: 'ftp://bad.example' })).toMatch(/http/);
    });
  });

  // ----- html -----
  describe('html', () => {
    it('accepts article mode with urls', () => {
      expect(validateSourceConfig('html', { urls: ['https://a.com'] })).toBeNull();
    });
    it('rejects article mode with empty urls', () => {
      expect(validateSourceConfig('html', { urls: [] })).toMatch(/urls/);
    });
    it('accepts crawl mode with entry', () => {
      expect(validateSourceConfig('html', { mode: 'crawl', entry: 'https://site.com' })).toBeNull();
    });
    it('rejects crawl mode without entry', () => {
      expect(validateSourceConfig('html', { mode: 'crawl' })).toMatch(/entry/);
    });
    it('rejects non-http url in urls array', () => {
      expect(validateSourceConfig('html', { urls: ['not-a-url'] })).toMatch(/http/);
    });
  });

  // ----- reddit -----
  describe('reddit', () => {
    it('accepts single subreddit', () => {
      expect(validateSourceConfig('reddit', { subreddit: 'programming' })).toBeNull();
    });
    it('accepts subreddits array', () => {
      expect(validateSourceConfig('reddit', { subreddits: ['programming', 'rust'] })).toBeNull();
    });
    it('rejects empty config', () => {
      expect(validateSourceConfig('reddit', {})).toMatch(/subreddit/);
    });
  });

  // ----- bluesky -----
  describe('bluesky', () => {
    it('accepts author mode with actor', () => {
      expect(validateSourceConfig('bluesky', { actor: 'pfrazee.com' })).toBeNull();
    });
    it('rejects author mode without actor', () => {
      expect(validateSourceConfig('bluesky', {})).toMatch(/actor/);
    });
    it('accepts search mode with query', () => {
      expect(validateSourceConfig('bluesky', { mode: 'search', query: '#typescript' })).toBeNull();
    });
    it('rejects search mode without query', () => {
      expect(validateSourceConfig('bluesky', { mode: 'search' })).toMatch(/query/);
    });
    it('rejects unknown mode', () => {
      expect(validateSourceConfig('bluesky', { mode: 'feed' })).toMatch(/mode/);
    });
  });

  // ----- x -----
  describe('x', () => {
    it('accepts user mode with cookie + screenName', () => {
      expect(validateSourceConfig('x', { cookie: 'auth_token=abc; ct0=xyz', screenName: 'natgeo' })).toBeNull();
    });
    it('rejects missing cookie', () => {
      expect(validateSourceConfig('x', { screenName: 'natgeo' })).toMatch(/cookie/);
    });
    it('rejects cookie without ct0', () => {
      expect(validateSourceConfig('x', { cookie: 'auth_token=abc', screenName: 'natgeo' })).toMatch(/ct0/);
    });
    it('rejects user mode without screenName', () => {
      expect(validateSourceConfig('x', { cookie: 'auth_token=abc; ct0=xyz' })).toMatch(/screenName/);
    });
    it('accepts search mode with query', () => {
      expect(validateSourceConfig('x', { cookie: 'auth_token=abc; ct0=xyz', mode: 'search', query: '#ai' })).toBeNull();
    });
  });

  // ----- edge cases -----
  it('rejects unknown platforms with a descriptive error', () => {
    expect(validateSourceConfig('unknown-platform', {})).toMatch(/未知平台/);
  });
  it('treats null config as empty object', () => {
    expect(validateSourceConfig('reddit', null)).toMatch(/subreddit/);
  });
});
