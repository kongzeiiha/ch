const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Allow the production deploy host (and any extra ALLOWED_DEV_ORIGINS env
  // values) to fetch /_next/* assets in dev. Without this Next 15+ warns on
  // every cross-origin asset request from 3333.lq.qrxsrg03.work — and a
  // future major will outright block them. ENV-driven so we don't hard-code
  // any specific deploy host into the repo.
  allowedDevOrigins: [
    ...(process.env.ALLOWED_DEV_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    '3333.lq.qrxsrg03.work',
    'localhost',
    '127.0.0.1',
  ],
  // Compile workspace packages through Next's own SWC instead of relying on
  // their pre-built dist/. Avoids "Cannot read properties of undefined" errors
  // from webpack mis-resolving ESM workspace exports, and means changes in
  // packages/* hot-reload without a separate `tsc -w` watcher.
  transpilePackages: ['@ch/db', '@ch/agents'],
  // Keep server-only Node packages OUT of the webpack server bundle. Reasons:
  //   - mysql2 has a native binding fallback and worker_threads — bundling
  //     produces vendor-chunks/<hashed>.js that pnpm's deep symlink layout
  //     occasionally fails to resolve at runtime (the "Cannot find module
  //     vendor-chunks/mysql2@x.y.z_..." we kept hitting).
  //   - ioredis ships dynamic require + cluster code that webpack mangles.
  //   - bullmq depends on ioredis + worker_threads, same problem.
  //   - playwright (used by ingestion adapter via @ch/agents) carries
  //     browser binaries — never bundle.
  // Listing them here makes Next `require()` them directly at runtime from
  // node_modules, so pnpm's exact path resolution always wins.
  serverExternalPackages: ['mysql2', 'ioredis', 'bullmq', 'playwright', 'playwright-core'],
  // STATIC_EXPORT=1 → emit pure static HTML to apps/web/out/ (no Node needed).
  // Default (dev / regular `next build`) → SSR/ISR mode unchanged.
  ...(STATIC_EXPORT ? {
    output: 'export',
    images: { unoptimized: true },
    trailingSlash: true, // /a/foo/ → out/a/foo/index.html (cleaner CDN paths)
  } : {}),
  // Static export can't ship rewrites or server route handlers.
  ...(STATIC_EXPORT ? {} : {
    async rewrites() {
      const apiTarget = process.env.API_URL ?? 'http://localhost:4000';
      return [{ source: '/api/:path*', destination: `${apiTarget}/:path*` }];
    },
  }),
  // Shrink the watcher footprint — avoids EMFILE on macOS where the default
  // per-process file-handle limit is low and chokidar tries to watch every
  // nested node_modules.
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 1500,           // check every 1.5s instead of using fs events
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.next/**', '**/.git/**'],
      };
    }
    return config;
  },
};

export default nextConfig;
