#!/usr/bin/env node
/**
 * Catches the Next.js App Router footgun where a page.tsx declares
 * BOTH `export const dynamic = 'force-dynamic'` and `generateStaticParams`.
 *
 * Reason: in 14.x they coexist silently but the static-paths-worker still
 * boots, picks up a stale pnpm vendor-chunks graph, and 500s with
 * "Cannot find module './vendor-chunks/<dep>@<hash>.js'".
 *
 * Run via `pnpm lint:routes` (added in package.json scripts) or wire into
 * a pre-commit hook.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  "git ls-files 'apps/web/src/app/**/page.tsx' 'apps/web/src/app/**/layout.tsx'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const offenders = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const hasForceDynamic = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src);
  const hasStaticParams = /export\s+(async\s+)?function\s+generateStaticParams\b/.test(src);
  if (hasForceDynamic && hasStaticParams) {
    offenders.push(f);
  }
}

if (offenders.length > 0) {
  console.error('\n✗ 路由配置冲突: 同一个文件不能同时声明 force-dynamic 和 generateStaticParams\n');
  for (const f of offenders) console.error(`  - ${f}`);
  console.error('\n选一个:');
  console.error("  • 要 ISR 预渲染 → 删掉 force-dynamic, 改 export const revalidate = 600");
  console.error("  • 要每次请求新数据 → 删掉 generateStaticParams\n");
  process.exit(1);
}

console.log(`✓ 检查 ${files.length} 个 page/layout, 无 force-dynamic + generateStaticParams 冲突`);
