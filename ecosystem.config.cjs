/**
 * PM2 生产进程配置。
 *
 * 用法 (服务器上):
 *   cd /root/ch
 *   git pull && pnpm install --frozen-lockfile
 *   pnpm --filter web build && pnpm --filter api build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * 两个进程都用 pnpm 的生产 start (next start / 编译后的 dist),
 * 不要用 `pnpm dev` — 那是开发模式, 跑 prod 会暴露 HMR + cross-origin warning。
 *
 * 日志: ~/.pm2/logs/<name>-{out,error}.log
 * 进程崩了自动重启, 内存超 max_memory_restart 也会重启。
 */
module.exports = {
  apps: [
    {
      name: 'ch-web',
      cwd: __dirname,
      // pnpm --filter web start 内部跑 `next start -p 3000`
      script: 'pnpm',
      args: '--filter web start',
      env: {
        NODE_ENV: 'production',
        // PORT/HOST 在 .env 里设过的话 pnpm dotenv 会带过来;
        // 没设的话 next start 默认 :3000。
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
