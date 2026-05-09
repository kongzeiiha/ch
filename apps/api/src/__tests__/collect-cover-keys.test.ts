import { describe, it, expect } from 'vitest';
import { collectCoverKeys } from '../workers/cover/storage.js';

// S3 endpoint + bucket are read at module load time via env defaults:
//   S3_ENDPOINT defaults to http://localhost:9000
//   S3_BUCKET   defaults to ch-media
// extractKey looks for `/${bucket}/` so anything under
// http://localhost:9000/ch-media/<key> should round-trip.
const E = 'http://localhost:9000/ch-media';

describe('collectCoverKeys', () => {
  it('returns empty when nothing is set', () => {
    expect(collectCoverKeys(null, null)).toEqual([]);
    expect(collectCoverKeys(undefined, undefined)).toEqual([]);
  });

  it('extracts key from cover_url alone', () => {
    expect(collectCoverKeys(`${E}/covers/abc/card.jpg`, null)).toEqual([
      'covers/abc/card.jpg',
    ]);
  });

  it('walks {og,card,thumb} keys in cover_sizes', () => {
    const sizes = {
      og:    `${E}/covers/abc/og.jpg`,
      card:  `${E}/covers/abc/card.jpg`,
      thumb: `${E}/covers/abc/thumb.jpg`,
    };
    const keys = collectCoverKeys(`${E}/covers/abc/card.jpg`, sizes);
    expect(new Set(keys)).toEqual(
      new Set(['covers/abc/og.jpg', 'covers/abc/card.jpg', 'covers/abc/thumb.jpg']),
    );
  });

  it('walks gallery entries', () => {
    const sizes = {
      og:    `${E}/covers/abc/og.jpg`,
      card:  `${E}/covers/abc/card.jpg`,
      thumb: `${E}/covers/abc/thumb.jpg`,
      gallery: [
        { og: `${E}/covers/gallery/1/abc/og.jpg`, card: `${E}/covers/gallery/1/abc/card.jpg` },
        { og: `${E}/covers/gallery/2/abc/og.jpg` },
      ],
    };
    const keys = collectCoverKeys(null, sizes);
    expect(new Set(keys)).toEqual(
      new Set([
        'covers/abc/og.jpg', 'covers/abc/card.jpg', 'covers/abc/thumb.jpg',
        'covers/gallery/1/abc/og.jpg', 'covers/gallery/1/abc/card.jpg',
        'covers/gallery/2/abc/og.jpg',
      ]),
    );
  });

  it('parses string-typed cover_sizes (defensive against driver/JSON variants)', () => {
    const sizes = JSON.stringify({
      og: `${E}/covers/abc/og.jpg`,
      card: `${E}/covers/abc/card.jpg`,
    });
    const keys = collectCoverKeys(null, sizes);
    expect(new Set(keys)).toEqual(
      new Set(['covers/abc/og.jpg', 'covers/abc/card.jpg']),
    );
  });

  it('ignores third-party CDN URLs that do not belong to our bucket', () => {
    const sizes = {
      og:   'https://cdn.example.com/foo.jpg',
      card: `${E}/covers/abc/card.jpg`,
    };
    const keys = collectCoverKeys('https://pbs.twimg.com/media/x.jpg', sizes);
    expect(keys).toEqual(['covers/abc/card.jpg']);
  });

  it('dedupes when cover_url matches one of the cover_sizes', () => {
    const url = `${E}/covers/abc/card.jpg`;
    const keys = collectCoverKeys(url, { card: url, og: `${E}/covers/abc/og.jpg` });
    expect(new Set(keys)).toEqual(new Set(['covers/abc/card.jpg', 'covers/abc/og.jpg']));
    // Ensure no duplicates leaked through
    expect(keys.length).toBe(2);
  });

  it('tolerates malformed JSON in cover_sizes', () => {
    expect(collectCoverKeys(null, '{not json')).toEqual([]);
  });

  it('ignores non-string nested values', () => {
    const sizes = { og: 42, card: null, gallery: [{ og: 7 }] } as any;
    expect(collectCoverKeys(null, sizes)).toEqual([]);
  });
});
