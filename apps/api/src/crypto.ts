import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * AES-256-GCM helper for encrypting credential secrets at rest.
 *
 * The key comes from CREDENTIAL_SECRET_KEY env var as 64 hex characters
 * (= 32 raw bytes). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Format of the encrypted blob:
 *   base64url(iv) + ":" + base64url(ciphertext) + ":" + base64url(authTag)
 *
 * Each call uses a fresh 12-byte IV so identical plaintexts encrypt to
 * different blobs. Tampering anywhere in iv/ciphertext/tag fails decryption.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;            // GCM standard
const KEY_LEN_HEX = 64;       // 32 bytes = 64 hex chars

let _cachedKey: Buffer | null = null;
function key(): Buffer {
  if (_cachedKey) return _cachedKey;
  const hex = process.env.CREDENTIAL_SECRET_KEY;
  if (!hex) {
    throw new Error(
      'CREDENTIAL_SECRET_KEY env var is missing. ' +
      'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (hex.length !== KEY_LEN_HEX || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      `CREDENTIAL_SECRET_KEY must be exactly ${KEY_LEN_HEX} hex chars (32 raw bytes). Got ${hex.length}.`,
    );
  }
  _cachedKey = Buffer.from(hex, 'hex');
  return _cachedKey;
}

/** Reset the cached key — for tests that want to rotate the env var. */
export function resetKeyCache(): void {
  _cachedKey = null;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') throw new Error('encrypt: plaintext must be string');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ct, tag].map((b) => b.toString('base64url')).join(':');
}

export function decrypt(blob: string): string {
  if (typeof blob !== 'string' || !blob.includes(':')) {
    throw new Error('decrypt: blob is not in iv:ct:tag format');
  }
  const parts = blob.split(':');
  if (parts.length !== 3) throw new Error('decrypt: blob must have 3 segments');
  const [iv, ct, tag] = parts.map((s) => Buffer.from(s, 'base64url'));
  if (iv.length !== IV_LEN) throw new Error(`decrypt: iv must be ${IV_LEN} bytes`);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
