import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '..', '..', '..', '.env') });
const { query } = await import('@ch/db');
const { resolveAuth } = await import('../src/workers/ingestion/adapters/auth.js');
const [src] = await query<any>(
  `SELECT id, platform, external_id, name, url, config, credential_id FROM sources WHERE external_id = $1`,
  [process.argv[2]],
);
if (!src) { console.log('  (no source)'); process.exit(0); }
const out = await resolveAuth(src);
console.log(`  cookie    = ${out.cookie}`);
console.log(`  userAgent = ${out.userAgent}`);
console.log(`  credId    = ${out.credentialId}`);
process.exit(0);
