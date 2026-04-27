/**
 * Sentry wrapper — conditional on SENTRY_DSN being set AND the package being installed.
 * Works gracefully (falls back to console.error) when neither is true.
 *
 * Install: pnpm --filter @ch/api add @sentry/node
 */

let _captureException: ((e: unknown, extra?: Record<string, unknown>) => void) | null = null;

async function init(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/node' as string);
    (Sentry as any).init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0.1,
    });
    _captureException = (e, extra) => {
      (Sentry as any).withScope((scope: any) => {
        if (extra) scope.setExtras(extra);
        (Sentry as any).captureException(e);
      });
    };
    console.info('[sentry] initialized');
  } catch {
    console.warn('[sentry] @sentry/node not installed — error reporting disabled');
  }
}

export async function initSentry(): Promise<void> {
  await init();
}

export function captureException(e: unknown, extra?: Record<string, unknown>): void {
  if (_captureException) {
    _captureException(e, extra);
  } else {
    console.error('[error]', e, extra ?? '');
  }
}
