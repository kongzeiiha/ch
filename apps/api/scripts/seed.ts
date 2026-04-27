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

const SEEDS: Array<{
  platform: string;
  external_id: string;
  name: string;
  url: string;
  config: Record<string, any>;
}> = [
  {
    platform: 'rss',
    external_id: 'smithsonian-history',
    name: 'Smithsonian Magazine — History',
    url: 'https://www.smithsonianmag.com/history',
    config: { feed_url: 'https://www.smithsonianmag.com/history/rss/', limit: 20 },
  },
  {
    platform: 'rss',
    external_id: 'historyextra',
    name: 'BBC History Extra',
    url: 'https://www.historyextra.com',
    config: { feed_url: 'https://www.historyextra.com/feed/', limit: 20 },
  },
  {
    platform: 'rss',
    external_id: 'world-history-encyclopedia',
    name: 'World History Encyclopedia',
    url: 'https://www.worldhistory.org',
    config: { feed_url: 'https://www.worldhistory.org/feed/', limit: 20 },
  },
  {
    platform: 'rss',
    external_id: 'jstor-daily',
    name: 'JSTOR Daily',
    url: 'https://daily.jstor.org',
    config: { feed_url: 'https://daily.jstor.org/feed/', limit: 20 },
  },
  {
    platform: 'rss',
    external_id: 'historynet',
    name: 'HistoryNet',
    url: 'https://www.historynet.com',
    config: { feed_url: 'https://www.historynet.com/feed/', limit: 20 },
  },
  {
    platform: 'rss',
    external_id: 'the-history-blog',
    name: 'The History Blog',
    url: 'http://www.thehistoryblog.com',
    config: { feed_url: 'http://www.thehistoryblog.com/feed', limit: 15 },
  },
];

async function main() {
  for (const s of SEEDS) {
    await query(
      `INSERT INTO sources (platform, external_id, name, url, config, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (platform, external_id) DO UPDATE SET
         name   = EXCLUDED.name,
         url    = EXCLUDED.url,
         config = EXCLUDED.config,
         status = 'active'`,
      [s.platform, s.external_id, s.name, s.url, s.config],
    );
    console.log(`+ ${s.platform}:${s.external_id}  ${s.name}`);
  }
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM sources`);
  console.log(`done. sources=${rows[0].count}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
