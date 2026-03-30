import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeLogObject } from './sanitize.js';

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------

describe('sanitizeString', () => {
  it('redacts GitHub PATs (ghp_)', () => {
    const s = 'token=ghp_ABCDEFGHIJKLMNOPQRSTUVWxyz12';
    expect(sanitizeString(s)).not.toContain('ghp_');
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('redacts GitHub server tokens (ghs_)', () => {
    const s = 'ghs_1234567890abcdefghijklmnopqrstuv';
    expect(sanitizeString(s)).not.toContain('ghs_');
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('redacts GitHub fine-grained PATs (github_pat_)', () => {
    const s = 'auth=github_pat_ABCDEFGHIJKLMNOPQRSTUVWX123456';
    expect(sanitizeString(s)).not.toContain('github_pat_');
  });

  it('redacts GitHub OAuth tokens (gho_)', () => {
    const s = 'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('redacts HTTP Bearer tokens', () => {
    const s = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    expect(sanitizeString(s)).not.toContain('Bearer eyJ');
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(sanitizeString(jwt)).not.toMatch(/eyJ/);
    expect(sanitizeString(jwt)).toContain('[REDACTED]');
  });

  it('redacts OpenAI-style keys (sk-)', () => {
    const s = 'key=sk-abcdefghijklmnopqrstuvwxyz12345678';
    expect(sanitizeString(s)).not.toContain('sk-abc');
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('redacts AWS access key IDs', () => {
    const s = 'AKIAIOSFODNN7EXAMPLE is an AWS key';
    expect(sanitizeString(s)).not.toContain('AKIA');
    expect(sanitizeString(s)).toContain('[REDACTED]');
  });

  it('leaves plain strings untouched', () => {
    const s = 'Agent connected to host 192.168.1.1 on port 7777';
    expect(sanitizeString(s)).toBe(s);
  });

  it('is idempotent — double-sanitizing does not corrupt the output', () => {
    const s = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
    const once = sanitizeString(s);
    const twice = sanitizeString(once);
    expect(once).toBe(twice);
  });

  it('redacts multiple secrets in a single string', () => {
    const s = 'token1=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA token2=ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const result = sanitizeString(s);
    expect((result.match(/\[REDACTED\]/g) ?? []).length).toBe(2);
  });

  it('returns an empty string unchanged', () => {
    expect(sanitizeString('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sanitizeLogObject
// ---------------------------------------------------------------------------

describe('sanitizeLogObject', () => {
  it('redacts string values at the top level', () => {
    const obj = { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' };
    const result = sanitizeLogObject(obj);
    expect(result['token']).not.toContain('ghp_');
    expect(result['token']).toContain('[REDACTED]');
  });

  it('redacts string values in nested objects', () => {
    const obj = { auth: { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' } };
    const result = sanitizeLogObject(obj);
    expect((result['auth'] as Record<string, unknown>)['token']).toContain('[REDACTED]');
  });

  it('leaves non-string values unchanged', () => {
    const obj = { count: 42, flag: true, nothing: null };
    const result = sanitizeLogObject(obj);
    expect(result['count']).toBe(42);
    expect(result['flag']).toBe(true);
    expect(result['nothing']).toBeNull();
  });

  it('leaves arrays unchanged', () => {
    const obj = { tags: ['a', 'b', 'c'] };
    const result = sanitizeLogObject(obj);
    expect(result['tags']).toEqual(['a', 'b', 'c']);
  });

  it('handles empty objects', () => {
    expect(sanitizeLogObject({})).toEqual({});
  });

  it('does not mutate the input object', () => {
    const obj = { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' };
    sanitizeLogObject(obj);
    expect(obj['token']).toBe('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj['self'] = obj; // circular reference
    expect(() => sanitizeLogObject(obj)).not.toThrow();
    const result = sanitizeLogObject(obj);
    expect((result['self'] as Record<string, unknown>)['[circular]']).toBe(true);
  });
});
