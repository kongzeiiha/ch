import pg from 'pg';

const { Pool } = pg;

// Server-only. Cached across Next.js server component renders via global var.
declare global {
  // eslint-disable-next-line no-var
  var __chPool: pg.Pool | undefined;
}

function pool(): pg.Pool {
  if (!global.__chPool) {
    global.__chPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return global.__chPool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool().query(text, params);
  return res.rows as T[];
}

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
export const SITE_NAME = process.env.SITE_NAME ?? '内容中台';
