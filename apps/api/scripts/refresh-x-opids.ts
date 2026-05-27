/**
 * 自动刷新 X (Twitter) GraphQL opId — 写入项目根 .env。
 *
 * 原理:opId 是 X 前端 bundle 里写死的 GraphQL operation hash,每 2-4 周
 * 跟随 X 发版轮换一次。手动抓需要打开 DevTools 找 Network 里 URL 的那一段,
 * 跟人工活计差不多。这个脚本用同一个 cookie + Playwright(stealth)模拟
 * 浏览器走一遍触发各操作的页面,从 /i/api/graphql/<HASH>/<OperationName>
 * 请求里把 4 个我们关心的 opId 抓出来,然后 upsert 到 .env:
 *
 *   - TweetDetail        (评论同步用)
 *   - UserTweets         (拉博主时间线用)
 *   - UserByScreenName   (解析 handle → user_id 用)
 *   - SearchTimeline     (关键词找博主用)
 *
 * 用法 (服务器上):
 *   cd /root/ch
 *   pnpm --filter api exec tsx scripts/refresh-x-opids.ts
 *   pm2 restart ch-api --update-env
 *
 * cookie 来源(按优先级):
 *   1. env  X_REFRESH_COOKIE                 (一次性临时塞,跑完丢)
 *   2. DB   credentials.cookie  (status='active' AND kind='x' 取最新一条)
 *   3. 报错退出
 *
 * 失败情况:
 *   - 当前 cookie 已失效 → 抓不到 graphql 请求 (X 把你 302 到登录),报错
 *   - X 改了 URL 结构 → operationName 提取失败,看末尾 dump
 *   - 偶发反爬抖动 → 重跑即可,脚本幂等
 *
 * 输出:
 *   - 成功:打印 4 行 KEY=VALUE,并写入 .env (备份成 .env.bak.<ts>)
 *   - 部分成功:已抓到的写入,缺的提示手动补
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
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

import { query } from '@ch/db';

// 我们关心的 4 个 operation 名 → 写入 .env 的 key。
// 顺序也是触发的顺序 (先访问 profile 触发 UserByScreenName + UserTweets,
// 然后点击 tweet 触发 TweetDetail, 最后 explore 搜索触发 SearchTimeline)。
const TARGET_OPS: Array<{ op: string; envKey: string }> = [
  { op: 'UserByScreenName', envKey: 'X_OPID_USER_BY_SCREEN_NAME' },
  { op: 'UserTweets',       envKey: 'X_OPID_USER_TWEETS' },
  { op: 'TweetDetail',      envKey: 'X_OPID_TWEET_DETAIL' },
  { op: 'SearchTimeline',   envKey: 'X_OPID_SEARCH_TIMELINE' },
];

// 任意一条公开活跃的 X 账号 — UserByScreenName / UserTweets 会被它的 profile 加载触发。
// 选 'X' 本身这条是最安全的:always exists, 不会被 ban/suspend。
const SEED_PROFILE = 'X';
// 用 X 自己最 pinned 的 tweet 触发 TweetDetail — pinned tweet 不会被删除。
// 任何活跃推文 id 也行;这里用 X 官方账号一条不会消失的公告。
const SEED_TWEET_URL = 'https://x.com/X/status/1853924130729996386';
// SearchTimeline 用任意关键词触发即可。
const SEED_SEARCH_KEYWORD = 'hello';

const OP_PATH_RE = /\/i\/api\/graphql\/([A-Za-z0-9_-]{16,32})\/([A-Za-z0-9_]+)\b/;

async function resolveCookie(): Promise<string> {
  const fromEnv = (process.env.X_REFRESH_COOKIE ?? '').trim();
  if (fromEnv) {
    console.log('[refresh-opids] 用 env X_REFRESH_COOKIE 提供的 cookie');
    return fromEnv;
  }
  const rows = await query<{ cookie: string | null }>(
    `SELECT cookie FROM credentials
     WHERE kind='x' AND status='active' AND cookie IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  if (rows[0]?.cookie) {
    console.log('[refresh-opids] 用 DB credentials 里最新的活跃 X cookie');
    return rows[0].cookie;
  }
  throw new Error(
    '找不到可用 cookie。要么 export X_REFRESH_COOKIE="auth_token=...; ct0=...",\n' +
    '要么先在 workbench 配一条 active 的 X 凭证。',
  );
}

function parseCookieHeader(cookieHeader: string): Array<{ name: string; value: string; domain: string; path: string }> {
  const out: Array<{ name: string; value: string; domain: string; path: string }> = [];
  for (const piece of cookieHeader.split(';')) {
    const s = piece.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    out.push({
      name: s.slice(0, eq).trim(),
      value: s.slice(eq + 1).trim(),
      domain: '.x.com',
      path: '/',
    });
  }
  return out;
}

async function main() {
  const cookie = await resolveCookie();

  console.log('[refresh-opids] 启动 Playwright(stealth)');
  // playwright-extra + stealth 已经是 worker 里的依赖, 复用同一份避免额外安装。
  const { chromium: chromiumExtra } = await import('playwright-extra');
  const stealthMod: any = await import('puppeteer-extra-plugin-stealth');
  const stealth = stealthMod.default ? stealthMod.default() : stealthMod();
  (chromiumExtra as any).use(stealth);

  const browser = await (chromiumExtra as any).launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addCookies(parseCookieHeader(cookie));
  const page = await context.newPage();

  // 抓所有 /i/api/graphql/<HASH>/<Op> 请求,记下第一个看到的 hash。
  // 后续重复请求同 op 通常 hash 一致,取首次即可。
  const opIds = new Map<string, string>();
  page.on('request', (req) => {
    const m = OP_PATH_RE.exec(req.url());
    if (!m) return;
    const [, hash, op] = m;
    if (!opIds.has(op)) opIds.set(op, hash);
  });

  // 触发 UserByScreenName + UserTweets
  console.log(`[refresh-opids] 访问 https://x.com/${SEED_PROFILE}`);
  try {
    await page.goto(`https://x.com/${SEED_PROFILE}`, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (e: any) {
    console.warn('[refresh-opids] profile 加载超时(可忽略,只要抓到请求即可):', e?.message);
  }
  await page.waitForTimeout(2500); // 让 timeline 自动加载触发 UserTweets

  // 触发 TweetDetail
  console.log(`[refresh-opids] 访问 ${SEED_TWEET_URL}`);
  try {
    await page.goto(SEED_TWEET_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (e: any) {
    console.warn('[refresh-opids] tweet 加载超时:', e?.message);
  }
  await page.waitForTimeout(2500);

  // 触发 SearchTimeline
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(SEED_SEARCH_KEYWORD)}&src=typed_query&f=top`;
  console.log(`[refresh-opids] 访问 ${searchUrl}`);
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (e: any) {
    console.warn('[refresh-opids] search 加载超时:', e?.message);
  }
  await page.waitForTimeout(2500);

  await browser.close();

  // 检查抓到了哪些, 缺什么
  const found = TARGET_OPS.map(({ op, envKey }) => ({ op, envKey, hash: opIds.get(op) }));
  console.log('\n[refresh-opids] 抓取结果:');
  for (const f of found) {
    console.log(`  ${f.envKey}=${f.hash ?? '(MISSING)'}`);
  }
  if (process.env.DEBUG_OPIDS) {
    console.log('\n[refresh-opids] 所有抓到的 op → hash:');
    for (const [op, h] of opIds) console.log(`  ${op}=${h}`);
  }

  const writable = found.filter((f) => f.hash);
  if (writable.length === 0) {
    console.error(
      '\n一个都没抓到。常见原因:\n' +
      '  1. cookie 失效 → X 把请求 302 到登录,看不到 /graphql 请求\n' +
      '  2. 站点被墙 / 网络抖 → 重跑\n' +
      '  3. X 改了 URL 结构(罕见,DEBUG_OPIDS=1 重跑 dump 看看实际 path)',
    );
    process.exit(1);
  }

  // 找项目根 .env 写入
  let envPath = '';
  {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const p = resolve(dir, '.env');
      if (existsSync(p)) { envPath = p; break; }
      dir = resolve(dir, '..');
    }
  }
  if (!envPath) {
    console.error('\n找不到项目根 .env,不写入。复制下面这几行手动添加:');
    for (const f of writable) console.log(`  ${f.envKey}=${f.hash}`);
    process.exit(0);
  }

  // 备份原文件
  const bakPath = `${envPath}.bak.${Date.now()}`;
  copyFileSync(envPath, bakPath);
  const original = readFileSync(envPath, 'utf8');
  let next = original;
  for (const f of writable) {
    const re = new RegExp(`^${f.envKey}=.*$`, 'm');
    if (re.test(next)) {
      next = next.replace(re, `${f.envKey}=${f.hash}`);
    } else {
      next = next + (next.endsWith('\n') ? '' : '\n') + `${f.envKey}=${f.hash}\n`;
    }
  }
  if (next !== original) {
    writeFileSync(envPath, next);
    console.log(`\n.env 已更新 → ${envPath}`);
    console.log(`原文件备份在 ${bakPath}`);
  } else {
    console.log('\n.env 内容无变化(opId 跟现有值一致)');
  }

  const missing = found.filter((f) => !f.hash);
  if (missing.length > 0) {
    console.log('\n以下 opId 这次没抓到,稍后重跑或手动补:');
    for (const m of missing) console.log(`  ${m.envKey}  (op=${m.op})`);
  }

  console.log('\n要让 worker 读到新值,记得重启:  pm2 restart ch-api --update-env');
}

main().catch((e) => {
  console.error('[refresh-opids] failed:', e?.message ?? e);
  process.exit(1);
}).finally(() => {
  // 显式退出,防 mysql/playwright 残留连接挂住进程
  setTimeout(() => process.exit(0), 500);
});
