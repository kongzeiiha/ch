// Cookie-based auth helpers. Uses Web Crypto API only — works in Edge runtime
// (middleware) and Node.js (API routes) without any polyfill.

export const COOKIE_NAME = 'ch_auth';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.ADMIN_PASSWORD ?? '';
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret || 'dev-only-insecure'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const pairs = hex.match(/../g);
  if (!pairs) return new Uint8Array(0);
  return Uint8Array.from(pairs.map((h) => parseInt(h, 16)));
}

export async function signToken(username: string): Promise<string> {
  const expiry = Date.now() + TTL_MS;
  const payload = `${username}:${expiry}`;
  const key = await importKey(getSecret());
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${btoa(payload)}.${toHex(sig)}`;
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const encoded = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    const payload = atob(encoded);
    const [username, expiryStr] = payload.split(':');
    if (!username || !expiryStr) return null;
    if (Date.now() > Number(expiryStr)) return null;
    const key = await importKey(getSecret());
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromHex(sigHex).buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
    return valid ? username : null;
  } catch {
    return null;
  }
}

export const TTL_SECONDS = Math.floor(TTL_MS / 1000);
