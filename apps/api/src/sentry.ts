/**
 * Sentry wrapper — conditional on SENTRY_DSN being set AND the package being installed.
 * Works gracefully (falls back to console.error) when neither is true.
 *
 * Install: pnpm --filter @ch/api add @sentry/node
 *
 * Trace wiring: on init we register a span provider with @ch/agents/runner so
 * every withRun() call automatically creates a Sentry span. No worker code
 * changes needed — the trace context flows through the provider hook.
 */

let _captureException: ((e: unknown, extra?: Record<string, unknown>) => void) | null = null;
let _flush: ((timeoutMs: number) => Promise<boolean>) | null = null;

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
    _flush = (timeoutMs) => (Sentry as any).flush(timeoutMs);

    // Wire every withRun() call into a Sentry span so the full pipeline is
    // traceable. Dynamic import avoids a hard dep at the top of this file.
    const { setSpanProvider } = await import('@ch/agents');
    setSpanProvider(<T>(name: string, attrs: Record<string, string>, fn: () => Promise<T>) =>
      (Sentry as any).startSpan({ op: 'agent', name, attributes: attrs }, () => fn()),
    );

    console.info('[sentry] initialized with trace context');
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

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!_flush) return;
  try { await _flush(timeoutMs); } catch { /* best-effort */ }
}
