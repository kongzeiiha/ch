// Integration smoke test for the MySQL client wrapper. Skipped automatically
// when DATABASE_URL is not set so CI without a DB stays green; run locally
// with `docker compose up -d mysql && pnpm migrate` before invoking vitest.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const enabled = !!process.env.DATABASE_URL;

// Per-test timeout headroom — DATABASE_URL may point at a remote host where a
// round-trip is ~1-3s; with multiple queries per test the default 5s blows up.
describe.skipIf(!enabled)('client integration (real MySQL)', { timeout: 15_000 }, () => {
  let query: typeof import('../client.js').query;
  let execute: typeof import('../client.js').execute;
  let tx: typeof import('../client.js').tx;
  let pool: typeof import('../client.js').pool;
  // Track inserted rows so afterAll can clean up even if assertions fail.
  const sourceIds: string[] = [];

  beforeAll(async () => {
    ({ query, execute, tx, pool } = await import('../client.js'));
  });

  afterAll(async () => {
    if (sourceIds.length > 0) {
      await query(
        `DELETE FROM sources WHERE id = ANY($1::text[])`,
        [sourceIds],
      );
    }
    await pool.end();
  });

  it('round-trips $N placeholders + JSON column writes', async () => {
    const id = randomUUID();
    sourceIds.push(id);
    await query(
      `INSERT INTO sources (id, platform, external_id, name, config)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, 'rss', `it-test-${id}`, 'integration test', { feed_url: 'http://x' }],
    );
    const rows = await query<{ id: string; name: string; config: any }>(
      `SELECT id, name, config FROM sources WHERE id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('integration test');
    expect(rows[0]!.config).toEqual({ feed_url: 'http://x' });
  });

  it('execute() returns affectedRows for conditional UPDATE', async () => {
    const id = randomUUID();
    sourceIds.push(id);
    await query(
      `INSERT INTO sources (id, platform, external_id, name, config)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, 'rss', `it-exec-${id}`, 'before', {}],
    );

    // Match: should affect 1 row
    const hit = await execute(
      `UPDATE sources SET name = $2 WHERE id = $1 AND name = 'before'`,
      [id, 'after'],
    );
    expect(hit.affectedRows).toBe(1);

    // Miss: WHERE clause filters everything out → 0 rows
    const miss = await execute(
      `UPDATE sources SET name = $2 WHERE id = $1 AND name = 'before'`,
      [id, 'never'],
    );
    expect(miss.affectedRows).toBe(0);
  });

  it('= ANY($N::text[]) expands and matches multiple rows', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    sourceIds.push(id1, id2);
    for (const [id, name] of [[id1, 'A'], [id2, 'B']] as const) {
      await query(
        `INSERT INTO sources (id, platform, external_id, name, config)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, 'rss', `it-any-${id}`, name, {}],
      );
    }
    const rows = await query<{ id: string }>(
      `SELECT id FROM sources WHERE id = ANY($1::text[])`,
      [[id1, id2]],
    );
    expect(rows.map((r) => r.id).sort()).toEqual([id1, id2].sort());
  });

  it('tx() commits on success', async () => {
    const id = randomUUID();
    sourceIds.push(id);
    await tx(async (q) => {
      await q(
        `INSERT INTO sources (id, platform, external_id, name, config)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, 'rss', `it-tx-ok-${id}`, 'tx', {}],
      );
    });
    const rows = await query<{ id: string }>(`SELECT id FROM sources WHERE id = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it('tx() rolls back when callback throws', async () => {
    const id = randomUUID();
    await expect(
      tx(async (q) => {
        await q(
          `INSERT INTO sources (id, platform, external_id, name, config)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, 'rss', `it-tx-rb-${id}`, 'tx-rb', {}],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await query<{ id: string }>(`SELECT id FROM sources WHERE id = $1`, [id]);
    expect(rows).toHaveLength(0);
  });
});
