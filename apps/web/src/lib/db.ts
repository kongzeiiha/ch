import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var __chPool: mysql.Pool | undefined;
}

// Same WHATWG URL parsing as packages/db — keeps Node from logging DEP0169
// (mysql2's internal `url.parse` fallback) on every server render.
function dsnToOptions(dsn: string): mysql.PoolOptions {
  const u = new URL(dsn);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

function pool(): mysql.Pool {
  if (!global.__chPool) {
    const dsn = process.env.DATABASE_URL;
    if (!dsn) throw new Error('DATABASE_URL is not set');
    global.__chPool = mysql.createPool({
      ...dsnToOptions(dsn),
      connectionLimit: 5,
      timezone: 'Z',
      // TCP keepalive keeps the conn warm so MySQL's wait_timeout (8h) and
      // any NAT / firewall idle-killer (often 5min) don't silently RST us.
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      // Recycle pool connections that have been idle for > 4 min — well under
      // typical idle-killer windows. Prevents PROTOCOL_CONNECTION_LOST on the
      // first query after the pool sat unused (overnight, between requests).
      idleTimeout: 240_000,
      maxIdle: 2,
    });
    // Surface async pool errors instead of letting them bubble up as unhandled
    // rejections. Reset the cached pool so the next query rebuilds it fresh
    // — without this a fatal error sticks around for the life of the process.
    // mysql2/promise's public Pool type narrows .on() to specific events; cast
    // to the underlying EventEmitter surface to listen for 'error' too.
    (global.__chPool as unknown as { on: (e: string, cb: (err: unknown) => void) => void }).on(
      'error',
      (err: any) => {
        console.warn('[db] pool error, will rebuild:', err?.code ?? err?.message ?? err);
        global.__chPool = undefined;
      },
    );
  }
  return global.__chPool;
}

// Errors that mean "this connection is dead but the SQL itself is fine —
// re-running it on a fresh conn should succeed." Anything else (syntax,
// constraint, etc.) must NOT retry.
const RETRYABLE_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

// Mirror packages/db's PG-style param adapter so server components can keep
// using $1, $2 placeholders without per-callsite changes.
function rebuild(text: string, params: unknown[]): { text: string; params: unknown[] } {
  const out: unknown[] = [];
  let result = '';
  let i = 0;
  while (i < text.length) {
    const anyMatch = text.slice(i).match(/^=\s*ANY\s*\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/i);
    if (anyMatch) {
      const idx = parseInt(anyMatch[1]!, 10) - 1;
      const v = params[idx];
      if (Array.isArray(v)) {
        if (v.length === 0) result += 'IN (NULL)';
        else { result += `IN (${v.map(() => '?').join(', ')})`; for (const el of v) out.push(el); }
      } else {
        result += '= ?'; out.push(v);
      }
      i += anyMatch[0].length;
      continue;
    }
    const castMatch = text.slice(i).match(/^::[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?(?:\[\])?/);
    if (castMatch) { i += castMatch[0].length; continue; }
    const paramMatch = text.slice(i).match(/^\$(\d+)/);
    if (paramMatch) {
      const idx = parseInt(paramMatch[1]!, 10) - 1;
      const v = params[idx];
      result += '?';
      const isJsonish = v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v);
      out.push(isJsonish ? JSON.stringify(v) : v);
      i += paramMatch[0].length;
      continue;
    }
    if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue; } j += 1; break; }
        j++;
      }
      result += text.slice(i, j); i = j; continue;
    }
    result += text[i]; i++;
  }
  return { text: result, params: out };
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const adapted = rebuild(text, params ?? []);
  try {
    const [rows] = await pool().query(adapted.text, adapted.params);
    return rows as T[];
  } catch (err: any) {
    // Single retry on transport-level failures. If the cached pool still holds
    // dead conns we drop it first so the retry pulls from a fresh one.
    if (RETRYABLE_CODES.has(err?.code)) {
      global.__chPool = undefined;
      const [rows] = await pool().query(adapted.text, adapted.params);
      return rows as T[];
    }
    throw err;
  }
}

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
export const SITE_NAME = process.env.SITE_NAME ?? '内容中台';
