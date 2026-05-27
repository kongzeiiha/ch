/**
 * PM2 生产进程配置。
 *
 * 用法 (服务器上):
 *   cd /root/Code/ch
 *   git pull && pnpm install --frozen-lockfile
 *   pnpm --filter web build && pnpm --filter api build
 *   pm2 start ecosystem.config.cjs --update-env
 *   pm2 save
 *
 * 两个进程都用 pnpm 的生产 start (next start / 编译后的 dist),
 * 不要用 `pnpm dev` — 那是开发模式, 跑 prod 会暴露 HMR + cross-origin warning。
 *
 * .env 自动加载 — 不依赖外部 shell source。改完 .env 直接
 *   pm2 restart ecosystem.config.cjs --update-env
 * 进程就拿到新值,不用手动 `set -a; source .env`(避开 .env 里非 KEY=VAL 行
 * 让 bash 报 `command not found` 的坑)。
 *
 * 日志: ~/.pm2/logs/<name>-{out,error}.log
 * 进程崩了自动重启, 内存超 max_memory_restart 也会重启。
 */

// 手动解析 .env 而不是依赖 dotenv 包,免去 `pnpm i dotenv` 的麻烦。
// 只接受 `KEY=VALUE` 这种规范行(KEY 以字母/下划线开头),其它一律跳过 —
// 这样 .env 里如果不小心混进了日志/注释/无效内容,也不会报错。
const fs = require('node:fs');
const path = require('node:path');
function readEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    // 剥掉首尾配对的单/双引号
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}
const ENV = readEnv();

module.exports = {
  apps: [
    {
      name: 'ch-web',
      cwd: __dirname,
      // pnpm --filter web start 内部跑 `next start -p 3000`
      script: 'pnpm',
      args: '--filter web start',
      env: {
        ...ENV,                  // 灌入 .env 里所有键
        NODE_ENV: 'production',  // 兜底显式覆盖
      },
      // Next start 单进程, instances=1 + fork 模式即可 (cluster 模式下 Next 会有 socket 重复绑定问题)
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      // 启动 5s 内崩 3 次以上停止重试, 防止配置错时无限重启刷日志
      max_restarts: 10,
      min_uptime: '10s',
      // 优雅关闭: pm2 reload 时给 5s 处理在飞请求
      kill_timeout: 5000,
      out_file: './logs/ch-web-out.log',
      error_file: './logs/ch-web-error.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'ch-api',
      cwd: __dirname,
      // pnpm --filter api start 跑编译后的 dist/index.js
      // (apps/api/package.json 里 start = node dist/index.js)
      script: 'pnpm',
      args: '--filter api start',
      env: {
        ...ENV,
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      // workers 跑 ingestion/cover/Playwright,内存吃比 web 重
      max_memory_restart: '2G',
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      out_file: './logs/ch-api-out.log',
      error_file: './logs/ch-api-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
