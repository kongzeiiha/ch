/**
 * Next.js instrumentation hook — runs once on server startup.
 * Initializes Sentry when SENTRY_DSN is set and @sentry/nextjs is installed.
 *
 * Install: pnpm --filter @ch/web add @sentry/nextjs
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const Sentry = await import('@sentry/nextjs' as string);
      (Sentry as any).init({ dsn, tracesSampleRate: 0.1 });
    }
  } catch {
    // @sentry/nextjs not installed — skip silently
  }
}
