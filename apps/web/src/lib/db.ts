import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var __chPool: mysql.Pool | undefined;
}

function pool(): mysql.Pool {
  if (!global.__chPool) {
    global.__chPool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: 5,
      timezone: 'Z',
    });
  }
  return global.__chPool;
}

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
  const [rows] = await pool().query(adapted.text, adapted.params);
  return rows as T[];
}

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
export const SITE_NAME = process.env.SITE_NAME ?? '内容中台';
