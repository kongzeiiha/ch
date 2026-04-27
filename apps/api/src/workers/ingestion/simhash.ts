import { createHash } from 'node:crypto';

/**
 * 63-bit simhash. 63 (not 64) so the result fits into Postgres BIGINT's
 * signed range without extra encoding. Entropy cost is negligible for dedupe.
 */

function hash64(s: string): bigint {
  const h = createHash('sha256').update(s).digest();
  return h.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  // 3-word shingles. For short texts fall back to bigrams, then unigrams.
  const n = words.length >= 6 ? 3 : words.length >= 3 ? 2 : 1;
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    out.push(words.slice(i, i + n).join(' '));
  }
  return out;
}

export function simhash(text: string): bigint {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0n;

  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  const bits = new Array<number>(63).fill(0);
  for (const [token, count] of counts) {
    const h = hash64(token);
    for (let i = 0; i < 63; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      bits[i] += bit === 1n ? count : -count;
    }
  }

  let result = 0n;
  for (let i = 0; i < 63; i++) {
    if (bits[i] > 0) result |= 1n << BigInt(i);
  }
  return result;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
