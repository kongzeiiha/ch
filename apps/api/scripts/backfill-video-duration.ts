/**
 * Backfill items.duration_sec for posts whose video was already stored in
 * MinIO before the duration tracking was added. Reads each video's mp4 mvhd
 * box and writes duration_sec back to the items row.
 *
 * Idempotent: skips items that already have a duration_sec. Safe to re-run.
 * Concurrency 4 keeps MinIO from getting hammered while not making the script
 * single-threaded slow on hundreds of files.
 *
 * Usage:
 *   pnpm --filter api exec tsx scripts/backfill-video-duration.ts
 */
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

const { query } = await import('@ch/db');
const axios = (await import('axios')).default;

// Same mp4 parser as workers/cover/storage.ts — inline here to avoid pulling
// the whole storage module + S3 client.
function readMp4DurationSec(buf: Buffer): number | null {
  try {
    const moov = findBox(buf, 0, buf.length, 'moov');
    if (!moov) return null;
    const mvhd = findBox(buf, moov.dataStart, moov.dataEnd, 'mvhd');
    if (!mvhd) return null;
    const version = buf.readUInt8(mvhd.dataStart);
    let timescale: number;
    let duration: number;
    if (version === 0) {
      timescale = buf.readUInt32BE(mvhd.dataStart + 4 + 4 + 4);
      duration  = buf.readUInt32BE(mvhd.dataStart + 4 + 4 + 4 + 4);
    } else {
      timescale = buf.readUInt32BE(mvhd.dataStart + 4 + 8 + 8);
      duration  = Number(buf.readBigUInt64BE(mvhd.dataStart + 4 + 8 + 8 + 4));
    }
    if (!timescale || !duration) return null;
    return Math.round(duration / timescale);
  } catch {
    return null;
  }
}

function findBox(buf: Buffer, start: number, end: number, type: string) {
  let off = start;
  while (off + 8 <= end) {
    const size = buf.readUInt32BE(off);
    const t = buf.toString('latin1', off + 4, off + 8);
    if (size === 0 || size === 1) return null;
    const next = off + size;
    if (next > end) return null;
    if (t === type) return { dataStart: off + 8, dataEnd: next };
    off = next;
  }
  return null;
}

interface Row {
  item_id: string;
  video_url: string;
}

async function probe(url: string): Promise<number | null> {
  try {
    const r = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 300 * 1024 * 1024,
      maxBodyLength: 300 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return readMp4DurationSec(Buffer.from(r.data));
  } catch (e: any) {
    console.warn(`  ⚠ ${url}: ${e?.message ?? e}`);
    return null;
  }
}

async function main() {
  const rows = await query<Row>(
    `SELECT i.id AS item_id,
            JSON_UNQUOTE(JSON_EXTRACT(r.video_urls, '$[0]')) AS video_url
     FROM items i
     JOIN raw_items r ON r.id = i.raw_item_id
     WHERE JSON_LENGTH(r.video_urls) > 0
       AND i.duration_sec IS NULL`,
  );

  console.log(`Backfilling ${rows.length} items …`);
  let done = 0;
  let ok = 0;
  let fail = 0;
  const concurrency = 4;

  const queue = [...rows];
  await Promise.all(
    Array(concurrency).fill(0).map(async () => {
      while (queue.length > 0) {
        const r = queue.shift();
        if (!r) break;
        const dur = await probe(r.video_url);
        if (dur != null) {
          await query(`UPDATE items SET duration_sec = $2 WHERE id = $1`, [r.item_id, dur]);
          ok++;
        } else {
          fail++;
        }
        done++;
        if (done % 20 === 0) {
          console.log(`  progress: ${done}/${rows.length}  ok=${ok}  fail=${fail}`);
        }
      }
    }),
  );

  console.log(`\nDone. ok=${ok}  fail=${fail}  (failures usually = video deleted from MinIO or non-mp4)`);

  // Quick distribution check
  const dist = await query<{ bucket: string; cnt: number }>(`
    SELECT CASE
             WHEN duration_sec IS NULL  THEN 'no_video'
             WHEN duration_sec <  300   THEN 'short (<5min)'
             WHEN duration_sec <  900   THEN 'medium (5-15min)'
             ELSE                            'long (>15min)'
           END AS bucket,
           COUNT(*) AS cnt
    FROM items
    GROUP BY bucket
    ORDER BY bucket
  `);
  console.log('\nDuration distribution:');
  for (const r of dist) console.log(`  ${r.bucket.padEnd(20)} ${r.cnt}`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
