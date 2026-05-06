import { describe, it, expect } from 'vitest';
import { rebuild } from '../client.js';

describe('rebuild — PG-to-MySQL SQL adapter', () => {
  describe('$N placeholders', () => {
    it('converts $1, $2 to ? in encounter order', () => {
      const r = rebuild('SELECT * FROM x WHERE a=$1 AND b=$2', ['alpha', 42]);
      expect(r.text).toBe('SELECT * FROM x WHERE a=? AND b=?');
      expect(r.params).toEqual(['alpha', 42]);
    });

    it('handles param reuse — same $N referenced twice produces two ?s', () => {
      // PG: WHERE a=$1 OR b=$1 (one logical param)
      // MySQL: WHERE a=? OR b=? (param array repeats)
      const r = rebuild('SELECT * FROM x WHERE a=$1 OR b=$1', ['v']);
      expect(r.text).toBe('SELECT * FROM x WHERE a=? OR b=?');
      expect(r.params).toEqual(['v', 'v']);
    });

    it('preserves param order across non-sequential $N references', () => {
      const r = rebuild('SELECT $2, $1, $2 FROM x', ['first', 'second']);
      expect(r.text).toBe('SELECT ?, ?, ? FROM x');
      expect(r.params).toEqual(['second', 'first', 'second']);
    });
  });

  describe('= ANY($N::type[]) array unpacking', () => {
    it('expands array param into IN (?, ?, ...)', () => {
      const r = rebuild(
        `SELECT id FROM items WHERE status = ANY($1::text[])`,
        [['INGESTED', 'CLASSIFIED']],
      );
      expect(r.text).toMatch(/IN \(\?, \?\)/);
      expect(r.params).toEqual(['INGESTED', 'CLASSIFIED']);
    });

    it('returns IN (NULL) when array is empty (matches no row)', () => {
      const r = rebuild(`WHERE x = ANY($1::int[])`, [[]]);
      expect(r.text).toBe('WHERE x IN (NULL)');
      expect(r.params).toEqual([]);
    });

    it('handles ANY without an explicit cast', () => {
      const r = rebuild(`WHERE x = ANY($1)`, [[1, 2, 3]]);
      expect(r.text).toBe('WHERE x IN (?, ?, ?)');
      expect(r.params).toEqual([1, 2, 3]);
    });

    it('falls back to single ? when ANY param is not an array', () => {
      const r = rebuild(`WHERE x = ANY($1::text[])`, ['scalar']);
      expect(r.text).toBe('WHERE x = ?');
      expect(r.params).toEqual(['scalar']);
    });

    it('combines ANY-expansion with regular $N placeholders', () => {
      const r = rebuild(
        `SELECT id FROM items WHERE source_id = $1 AND status = ANY($2::text[])`,
        ['src-1', ['A', 'B']],
      );
      expect(r.text).toBe('SELECT id FROM items WHERE source_id = ? AND status IN (?, ?)');
      expect(r.params).toEqual(['src-1', 'A', 'B']);
    });
  });

  describe('::cast stripping', () => {
    it('strips simple type casts (::int, ::text, ::uuid)', () => {
      const r = rebuild(`SELECT COUNT(*)::int AS cnt, name::text FROM x`, []);
      expect(r.text).toBe('SELECT COUNT(*) AS cnt, name FROM x');
    });

    it('strips parameterized casts like ::numeric(10,4)', () => {
      const r = rebuild(`SELECT pv::numeric(10,4) FROM x`, []);
      expect(r.text).toBe('SELECT pv FROM x');
    });

    it('strips array casts like ::text[]', () => {
      const r = rebuild(`SELECT $1::text[] AS tags`, [['a']]);
      // $1 stays as ? since it's not part of `= ANY(...)` pattern
      expect(r.text).toBe('SELECT ? AS tags');
    });
  });

  describe('string literal preservation', () => {
    it('does not strip casts inside string literals', () => {
      const r = rebuild(`SELECT 'foo::bar' AS x, baz::int FROM t`, []);
      expect(r.text).toBe(`SELECT 'foo::bar' AS x, baz FROM t`);
    });

    it('does not replace $N inside string literals', () => {
      const r = rebuild(`SELECT 'price is $1' AS msg, val FROM t WHERE id=$1`, ['v']);
      expect(r.text).toBe(`SELECT 'price is $1' AS msg, val FROM t WHERE id=?`);
      expect(r.params).toEqual(['v']);
    });

    it("handles SQL escape (doubled single quotes inside string)", () => {
      const r = rebuild(`SELECT 'don''t' AS x, $1`, ['v']);
      expect(r.text).toBe(`SELECT 'don''t' AS x, ?`);
      expect(r.params).toEqual(['v']);
    });
  });

  describe('array → JSON serialization', () => {
    it('JSON.stringifies arrays bound to plain $N (for JSON columns)', () => {
      const r = rebuild(
        `INSERT INTO items(tags) VALUES ($1)`,
        [['ai', 'tech', 'history']],
      );
      expect(r.text).toBe('INSERT INTO items(tags) VALUES (?)');
      // Without this, mysql2 would emit `'ai', 'tech', 'history'` (comma-list)
      // which is wrong for a JSON column.
      expect(r.params).toEqual(['["ai","tech","history"]']);
    });

    it('does NOT stringify arrays consumed by ANY() expansion', () => {
      const r = rebuild(`WHERE x = ANY($1::text[])`, [['a', 'b']]);
      // Each element should be its own param, not a JSON string
      expect(r.params).toEqual(['a', 'b']);
    });

    it('passes scalars through unchanged', () => {
      const r = rebuild(`SELECT $1, $2, $3`, ['str', 42, true]);
      expect(r.params).toEqual(['str', 42, true]);
    });

    it('JSON.stringifies plain objects bound to plain $N (for JSON columns)', () => {
      const r = rebuild(`UPDATE x SET data=$1`, [{ foo: 'bar' }]);
      expect(r.params).toEqual(['{"foo":"bar"}']);
    });

    it('passes Date and Buffer through unchanged (mysql2 handles them)', () => {
      const d = new Date('2026-05-06T00:00:00Z');
      const buf = Buffer.from([1, 2, 3]);
      const r = rebuild(`SELECT $1, $2`, [d, buf]);
      expect(r.params[0]).toBe(d);
      expect(r.params[1]).toBe(buf);
    });
  });

  describe('integration patterns from real call sites', () => {
    it('translates auto-pipeline status filter', () => {
      const r = rebuild(
        `SELECT id FROM items WHERE status = ANY($1::text[]) LIMIT 200`,
        [['INGESTED', 'CLASSIFIED']],
      );
      expect(r.text).toBe('SELECT id FROM items WHERE status IN (?, ?) LIMIT 200');
      expect(r.params).toEqual(['INGESTED', 'CLASSIFIED']);
    });

    it('translates an UPDATE with multiple casts and params', () => {
      // $2 appears before $1 in the SQL; rebuild walks left-to-right, so the
      // output params follow the ? order in the rebuilt SQL (which is what
      // mysql2 needs for positional binding).
      const r = rebuild(
        `UPDATE sources SET grayscale_pct = $2::int WHERE id = $1::uuid`,
        ['src-uuid', 50],
      );
      expect(r.text).toBe('UPDATE sources SET grayscale_pct = ? WHERE id = ?');
      expect(r.params).toEqual([50, 'src-uuid']);
    });

    it('translates an INSERT with a JSON-array column', () => {
      const r = rebuild(
        `INSERT INTO raw_items(id, source_id, media_urls, dedupe_key, content_hash, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['rid', 'sid', ['http://a.png', 'http://b.png'], 'k', 'h', { foo: 'bar' }],
      );
      expect(r.text).toMatch(/VALUES \(\?, \?, \?, \?, \?, \?\)/);
      // Array → JSON string; object → also JSON string for JSON columns
      expect(r.params[2]).toBe('["http://a.png","http://b.png"]');
      expect(r.params[5]).toBe('{"foo":"bar"}');
    });
  });
});
