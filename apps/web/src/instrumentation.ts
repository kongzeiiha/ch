/**
 * Next.js instrumentation hook — runs once on server startup.
 * Initializes Sentry when SENTRY_DSN is set and @sentry/nextjs is installed.
 *
 * Install: pnpm --filter @ch/web add @sentry/nextjs
 *
 * `webpackIgnore: true` is load-bearing: without it Next 14 statically
 * resolves the literal `'@sentry/nextjs'` at compile time and emits
 * "Module not found" on every recompile when the package isn't in
 * node_modules. The magic comment tells webpack to leave the import alone
 * so it runs as a native dynamic import at runtime — which is where the
 * try/catch can actually swallow the missing-module error.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    // @ts-ignore — optional dep, type may not be installed
    const Sentry = await import(/* webpackIgnore: true */ '@sentry/nextjs');
    (Sentry as any).init({ dsn, tracesSampleRate: 0.1 });
  } catch {
    // @sentry/nextjs not installed — skip silently
  }
}
