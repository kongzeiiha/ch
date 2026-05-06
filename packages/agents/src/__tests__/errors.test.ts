import { describe, it, expect } from 'vitest';
import { isTransient, permanent, UnrecoverableError } from '../errors.js';

describe('isTransient', () => {
  it.each([408, 429, 500, 502, 503, 504])('returns true for HTTP %i', (status) => {
    expect(isTransient(Object.assign(new Error(), { status }))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('returns false for HTTP %i', (status) => {
    expect(isTransient(Object.assign(new Error(), { status }))).toBe(false);
  });

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'])(
    'returns true for Node code %s',
    (code) => {
      expect(isTransient(Object.assign(new Error(), { code }))).toBe(true);
    },
  );

  it('returns false for UnrecoverableError', () => {
    expect(isTransient(new UnrecoverableError('permanent'))).toBe(false);
  });

  it('returns true for plain Error without status/code (default retryable)', () => {
    expect(isTransient(new Error('mystery error'))).toBe(true);
  });

  it('returns true for non-Error values', () => {
    expect(isTransient('string')).toBe(true);
    expect(isTransient(null)).toBe(true);
    expect(isTransient(42)).toBe(true);
  });

  it('reads axios-style response.status', () => {
    expect(isTransient(Object.assign(new Error(), { response: { status: 503 } }))).toBe(true);
    expect(isTransient(Object.assign(new Error(), { response: { status: 403 } }))).toBe(false);
  });

  it('reads statusCode property (got-style)', () => {
    expect(isTransient(Object.assign(new Error(), { statusCode: 500 }))).toBe(true);
    expect(isTransient(Object.assign(new Error(), { statusCode: 404 }))).toBe(false);
  });
});

describe('permanent', () => {
  it('throws UnrecoverableError', () => {
    expect(() => permanent('bad input')).toThrow(UnrecoverableError);
  });

  it('message is preserved', () => {
    expect(() => permanent('validation failed')).toThrow('validation failed');
  });

  it('attaches cause when provided', () => {
    const cause = new Error('root cause');
    try {
      permanent('wrapper', cause);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.cause).toBe(cause);
    }
  });

  it('never returns (return type is never)', () => {
    let reached = false;
    try {
      permanent('test');
      reached = true;
    } catch { /* expected */ }
    expect(reached).toBe(false);
  });
});
