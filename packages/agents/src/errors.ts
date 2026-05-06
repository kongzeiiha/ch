import { UnrecoverableError } from 'bullmq';

export { UnrecoverableError };

/**
 * HTTP status codes that indicate a transient failure worth retrying.
 * Everything else (400, 401, 403, 404, 422…) is a permanent client error.
 */
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Node error codes that indicate a transient network/infra issue.
 */
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EPIPE', 'EHOSTUNREACH', 'EAI_AGAIN',
]);

/**
 * Returns true if the error looks transient and the job should be retried.
 * Returns false for permanent errors (bad input, auth, not-found, etc.)
 * that burning retries on would waste quota and obscure the root cause.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof UnrecoverableError) return false;
  if (err instanceof Error) {
    const e = err as any;
    if (e.status != null) return TRANSIENT_HTTP.has(Number(e.status));
    if (e.statusCode != null) return TRANSIENT_HTTP.has(Number(e.statusCode));
    if (e.code != null) return TRANSIENT_CODES.has(String(e.code));
    // axios / got style
    if (e.response?.status != null) return TRANSIENT_HTTP.has(Number(e.response.status));
  }
  return true; // unknown errors default to retryable
}

/**
 * Throw this to skip all remaining retries and move the job directly to
 * the failed set (DLQ).  Use for auth failures, schema mismatches, or any
 * condition that will never succeed with the same inputs.
 *
 * BullMQ's UnrecoverableError is re-exported so callers don't need a direct
 * bullmq dependency just to signal non-retryable failures.
 */
export function permanent(msg: string, cause?: unknown): never {
  const err = new UnrecoverableError(msg);
  if (cause instanceof Error) (err as any).cause = cause;
  throw err;
}
