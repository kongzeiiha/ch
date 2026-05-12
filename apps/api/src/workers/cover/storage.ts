import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const bucket = process.env.S3_BUCKET ?? 'ch-media';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
  forcePathStyle: true,
});

let bucketReady: Promise<void> | null = null;

async function doEnsureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  // Dev-only: public read so the Next.js <img> tag can load covers directly.
  try {
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    );
  } catch {
    // Not fatal — MinIO may already have it set, or we're against real S3.
  }
}

export function ensureBucket(): Promise<void> {
  if (!bucketReady) bucketReady = doEnsureBucket();
  return bucketReady;
}

export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${endpoint}/${bucket}/${key}`;
}

/**
 * Stream a remote video URL (e.g. X CDN mp4) into MinIO. Uses axios + buffer
 * for simplicity — large files are OK up to MAX_VIDEO_BYTES (200MB by default;
 * tweet videos top out around 50MB so this is plenty headroom). Beyond that
 * limit the download is aborted and null is returned so the caller can keep
 * the original CDN URL as fallback.
 *
 * Returns the public MinIO URL on success, or null on any failure.
 * Failures are logged but not thrown — video storage is opportunistic.
 */
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES ?? 200 * 1024 * 1024);

/**
 * Pull the bucket-relative key out of a public URL we wrote earlier.
 * uploadBuffer returns `${endpoint}/${bucket}/${key}` so we look for the
 * `/<bucket>/` segment and take everything after.
 *
 * Returns null when the URL doesn't belong to our bucket (e.g. legacy CDN
 * cover_url or a 3rd-party host) — caller should ignore those, never delete.
 */
export function extractKey(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length);
}

/**
 * Walk an item's cover_url + cover_sizes JSON blob and collect every
 * bucket-relative key it references. Shape of cover_sizes:
 *   { og, card, thumb, gallery?: [{ og, card, thumb }, ...] }
 *
 * Used by every code path that nulls out an item's cover (source cascade
 * delete, rollback to TITLED, future single-item delete) so MinIO doesn't
 * accumulate orphans whenever the DB loses its reference to the keys.
 */
export function collectCoverKeys(
  coverUrl: string | null | undefined,
  coverSizes: unknown,
): string[] {
  const keys = new Set<string>();
  const k1 = extractKey(coverUrl);
  if (k1) keys.add(k1);
  let cs: any = coverSizes;
  if (typeof cs === 'string') {
    try { cs = JSON.parse(cs); } catch { cs = null; }
  }
  if (cs && typeof cs === 'object') {
    for (const v of Object.values(cs)) {
      if (typeof v === 'string') {
        const k = extractKey(v);
        if (k) keys.add(k);
      } else if (Array.isArray(v)) {
        for (const g of v) {
          if (g && typeof g === 'object') {
            for (const gv of Object.values(g)) {
              const k = extractKey(typeof gv === 'string' ? gv : null);
              if (k) keys.add(k);
            }
          }
        }
      }
    }
  }
  return [...keys];
}

/**
 * Batch-delete S3 objects by key. Splits into 1000-key chunks to stay under
 * the DeleteObjects API limit. Returns the number of successfully deleted
 * keys; failures are logged but don't throw — cover cleanup is best-effort,
 * never block the DB delete on it.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  await ensureBucket();
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const out = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += batch.length - (out.Errors?.length ?? 0);
      if (out.Errors?.length) {
        console.warn(`[storage] DeleteObjects: ${out.Errors.length} key(s) failed in batch starting ${batch[0]}`);
      }
    } catch (e: any) {
      console.warn(`[storage] DeleteObjects threw on batch starting ${batch[0]}: ${e?.message ?? e}`);
    }
  }
  return deleted;
}

export interface UploadedVideo {
  /** Public MinIO URL of the uploaded file. */
  url: string;
  /** Playback duration in seconds — parsed from the mp4 mvhd box. NULL when
   *  the file isn't mp4, the moov atom is at the end and got truncated, or
   *  parsing failed. */
  durationSec: number | null;
}

export async function uploadVideoFromUrl(
  sourceUrl: string,
  key: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<UploadedVideo | null> {
  const axios = (await import('axios')).default;
  try {
    const res = await axios.get<ArrayBuffer>(sourceUrl, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_VIDEO_BYTES,
      maxBodyLength: MAX_VIDEO_BYTES,
      timeout: 60_000,
      headers: opts.headers,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const buffer = Buffer.from(res.data);
    if (buffer.length === 0) {
      console.warn(`[video] empty body for ${sourceUrl}`);
      return null;
    }
    const contentType = (res.headers['content-type'] as string | undefined) ?? 'video/mp4';
    await ensureBucket();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const durationSec = readMp4DurationSec(buffer);
    return { url: `${endpoint}/${bucket}/${key}`, durationSec };
  } catch (e: any) {
    const msg = e?.response?.status
      ? `${e.response.status} ${e.response.statusText ?? ''}`
      : e?.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED' || e?.message?.includes('maxContentLength')
        ? `too large (>${MAX_VIDEO_BYTES} bytes)`
        : e?.message ?? String(e);
    console.warn(`[video] download/upload failed for ${sourceUrl}: ${msg}`);
    return null;
  }
}

/**
 * Inline MP4 duration parser. Walks the ISO BMFF box tree to find the moov
 * atom, then its mvhd (movie header) child, which carries `timescale` and
 * `duration` fields. Duration in seconds = duration_ticks / timescale.
 *
 * Spec ref: ISO/IEC 14496-12, §8.2.2 (Movie Header Box).
 *
 * Returns null when:
 *   - file isn't mp4 (no moov found)
 *   - mvhd missing
 *   - any read goes past the buffer (truncated download / mp4 with moov at
 *     end that wasn't fully buffered)
 */
function readMp4DurationSec(buf: Buffer): number | null {
  try {
    const moov = findBox(buf, 0, buf.length, 'moov');
    if (!moov) return null;
    const mvhd = findBox(buf, moov.dataStart, moov.dataEnd, 'mvhd');
    if (!mvhd) return null;
    // mvhd payload: version(1) + flags(3) + …
    const version = buf.readUInt8(mvhd.dataStart);
    let timescale: number;
    let duration: number;
    if (version === 0) {
      // v0: CT(4) MT(4) timescale(4) duration(4)
      timescale = buf.readUInt32BE(mvhd.dataStart + 4 + 4 + 4);
      duration  = buf.readUInt32BE(mvhd.dataStart + 4 + 4 + 4 + 4);
    } else {
      // v1: CT(8) MT(8) timescale(4) duration(8)
      timescale = buf.readUInt32BE(mvhd.dataStart + 4 + 8 + 8);
      duration  = Number(buf.readBigUInt64BE(mvhd.dataStart + 4 + 8 + 8 + 4));
    }
    if (!timescale || !duration) return null;
    return Math.round(duration / timescale);
  } catch {
    return null;
  }
}

/** Locate a box by 4-char type within a byte range. Returns the box's payload
 *  start/end (i.e. past the 8-byte size+type header). */
function findBox(buf: Buffer, start: number, end: number, type: string): { dataStart: number; dataEnd: number } | null {
  let off = start;
  while (off + 8 <= end) {
    const size = buf.readUInt32BE(off);
    const t = buf.toString('latin1', off + 4, off + 8);
    if (size === 0) return null;          // box runs to EOF — unsupported here
    if (size === 1) return null;          // 64-bit largesize — unsupported, rare
    const next = off + size;
    if (next > end) return null;
    if (t === type) return { dataStart: off + 8, dataEnd: next };
    off = next;
  }
  return null;
}
