import mysql from 'mysql2/promise';

let _pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: 10,
      // Numeric strings (DECIMAL) are returned as strings; call sites cast where needed.
      decimalNumbers: false,
      // Migration runner needs to execute multi-statement SQL files in one shot.
      multipleStatements: true,
      timezone: 'Z',
    });
  }
  return _pool;
}

/**
 * Translate Postgres-flavoured SQL to mysql2-compatible:
 *   - $1, $2 placeholders → ?, ?
 *   - `= ANY($N::type[])` → `IN (?, ?, ...)` with the array unpacked
 *   - `::name` / `::name(...)` / `::name[]` casts stripped (MySQL implicit-casts)
 *   - String literals are skipped so casts/$ inside strings aren't mangled
 *
 * Param reuse (`$1` referenced twice) is supported — each reference re-binds
 * the same JS value into the output param array.
 */
export function rebuild(text: string, params: unknown[]): { text: string; params: unknown[] } {
  const out: unknown[] = [];
  let result = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    // = ANY($N[::type[]])  →  IN (?, ?, ...)
    // The original `=ANY()` was glued to the preceding column name with no
    // intervening whitespace (e.g. `id=ANY($1)`), so a bare `IN (...)` would
    // produce `idIN (...)` and MySQL would interpret it as a function call.
    // Force a leading space when needed.
    const anyMatch = text.slice(i).match(/^=\s*ANY\s*\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/i);
    if (anyMatch) {
      const idx = parseInt(anyMatch[1]!, 10) - 1;
      const v = params[idx];
      const sep = result.length > 0 && /\S/.test(result[result.length - 1]!) ? ' ' : '';
      if (Array.isArray(v)) {
        if (v.length === 0) {
          result += `${sep}IN (NULL)`;
        } else {
          result += `${sep}IN (${v.map(() => '?').join(', ')})`;
          for (const el of v) out.push(el);
        }
      } else {
        result += '= ?';
        out.push(v);
      }
      i += anyMatch[0].length;
      continue;
    }

    // PG type casts: ::name / ::name(args) / ::name[]
    const castMatch = text.slice(i).match(/^::[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?(?:\[\])?/);
    if (castMatch) {
      i += castMatch[0].length;
      continue;
    }

    // $N  →  ?
    const paramMatch = text.slice(i).match(/^\$(\d+)/);
    if (paramMatch) {
      const idx = parseInt(paramMatch[1]!, 10) - 1;
      const v = params[idx];
      result += '?';
      // mysql2 mishandles JS objects/arrays bound to a single ? — Arrays become
      // comma-separated lists (intended for IN clauses) and plain objects fail
      // to serialize at all into JSON columns. Stringify both here so JSON
      // columns get valid JSON. Date/Buffer pass through to mysql2's escape.
      out.push(isJsonish(v) ? JSON.stringify(v) : v);
      i += paramMatch[0].length;
      continue;
    }

    // Pass through string literals untouched
    if (text[i] === "'") {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    result += text[i];
    i++;
  }

  return { text: result, params: out };
}

function isJsonish(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  if (v instanceof Date) return false;
  if (Buffer.isBuffer(v)) return false;
  return true; // plain object or array → JSON column
}

function findStringEnd(s: string, start: number): number {
  // Doubled single-quote is the PG/SQL escape: 'don''t'
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") { i += 2; continue; }
      return i + 1;
    }
    i++;
  }
  return s.length;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const adapted = rebuild(text, params ?? []);
  const [rows] = await getPool().query(adapted.text, adapted.params);
  return rows as T[];
}

/**
 * mysql2 returns an OkPacket on INSERT/UPDATE/DELETE. Use this when callers
 * need affectedRows / insertId instead of the rows array.
 */
export async function execute(text: string, params?: any[]): Promise<{ affectedRows: number; insertId: number | string }> {
  const adapted = rebuild(text, params ?? []);
  const [result] = await getPool().query(adapted.text, adapted.params);
  const r = result as { affectedRows?: number; insertId?: number | string };
  return { affectedRows: r.affectedRows ?? 0, insertId: r.insertId ?? 0 };
}

/**
 * Run the callback inside a single connection / transaction. The provided
 * `q` shares the connection so SELECT … FOR UPDATE works as intended.
 */
export async function tx<T>(
  fn: (q: (text: string, params?: any[]) => Promise<any[]>) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const q = async (text: string, params?: any[]): Promise<any[]> => {
      const adapted = rebuild(text, params ?? []);
      const [rows] = await conn.query(adapted.text, adapted.params);
      return rows as any[];
    };
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Migration runner uses this — keep the {rows, end} shape for minimal change. */
export const pool = {
  query: async (text: string, params?: any[]) => {
    const adapted = rebuild(text, params ?? []);
    const [rows] = await getPool().query(adapted.text, adapted.params);
    return { rows: rows as any[] };
  },
  end: async () => {
    if (_pool) { await _pool.end(); _pool = null; }
  },
};
