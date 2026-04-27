const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
