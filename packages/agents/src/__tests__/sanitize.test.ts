import { describe, it, expect } from 'vitest';
import { sanitizeForPrompt } from '../anthropic.js';

describe('sanitizeForPrompt', () => {
  it('returns empty string for null', () => {
    expect(sanitizeForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(sanitizeForPrompt('')).toBe('');
  });

  it('truncates to maxChars', () => {
    expect(sanitizeForPrompt('abcde', 3)).toBe('abc');
  });

  it('defaults to 8000 chars', () => {
    const long = 'x'.repeat(10_000);
    expect(sanitizeForPrompt(long)).toHaveLength(8000);
  });

  it('does not truncate text within limit', () => {
    expect(sanitizeForPrompt('hello', 100)).toBe('hello');
  });

  it('strips null bytes', () => {
    expect(sanitizeForPrompt('hel\x00lo')).toBe('hello');
  });

  it('strips low control characters except \\t \\n \\r', () => {
    // \x01–\x08, \x0B, \x0C, \x0E–\x1F should be stripped
    expect(sanitizeForPrompt('\x01\x02\x07text\x1F')).toBe('text');
    // Tab, newline, carriage return must survive
    expect(sanitizeForPrompt('a\tb\nc\r')).toBe('a\tb\nc\r');
  });

  it('strips ESC character', () => {
    // ESC = \x1B (in range \x0E–\x1F)
    expect(sanitizeForPrompt('normal\x1B[31mred')).toBe('normal[31mred');
  });

  it('strips DEL character (\\x7F)', () => {
    expect(sanitizeForPrompt('text\x7Fmore')).toBe('textmore');
  });

  it('preserves regular CJK text', () => {
    const text = '这是一段正常的中文内容。';
    expect(sanitizeForPrompt(text)).toBe(text);
  });
});
