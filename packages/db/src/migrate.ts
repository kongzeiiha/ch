import { config as loadEnv } from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// Walk up from this file to find the nearest .env (monorepo root). pnpm runs
// per-package scripts with cwd=<package>, so dotenv's default cwd-lookup misses it.
function loadRootEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) {
      loadEnv({ path: p });
      return;
    }
    dir = resolve(dir, '..');
  }
}
loadRootEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error('DATABASE_URL is not set');
  const u = new URL(dsn);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    multipleStatements: true,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const [rows] = await conn.query('SELECT 1 AS x FROM _migrations WHERE name = ?', [file]);
    if ((rows as any[]).length) {
      console.log(`- skip  ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    console.log(`+ apply ${file}`);
    try {
      await conn.beginTransaction();
      // multipleStatements is enabled, so the whole .sql file runs in one shot
      await conn.query(sql);
      await conn.query('INSERT INTO _migrations(name) VALUES (?)', [file]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  }

  await conn.end();
  console.log('migrations done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
