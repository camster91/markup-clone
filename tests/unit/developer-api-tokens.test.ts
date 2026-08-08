import { describe, expect, it } from 'vitest';
import {
  createDeveloperTokenSecret,
  hashDeveloperToken,
  parseBearerToken,
  validateDeveloperTokenExpiry,
  validateDeveloperTokenName,
} from '@/lib/developer-api-tokens';

describe('developer API token primitives', () => {
  it('creates a versioned high-entropy secret and persists only deterministic display metadata', () => {
    const created = createDeveloperTokenSecret();
    expect(created.secret).toMatch(/^mkv1_[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).toBe(hashDeveloperToken(created.secret));
    expect(created.prefix).toBe('mkv1_');
    expect(created.lastFour).toBe(created.secret.slice(-4));
    expect(created.tokenHash).not.toContain(created.secret);
  });

  it('parses one strict bearer credential and rejects malformed authorization', () => {
    expect(parseBearerToken('Bearer mkv1_abc')).toEqual({ ok: true, value: 'mkv1_abc' });
    expect(parseBearerToken('bearer mkv1_abc').ok).toBe(false);
    expect(parseBearerToken('Bearer one two').ok).toBe(false);
    expect(parseBearerToken(null).ok).toBe(false);
  });

  it('bounds token names and optional future expiry', () => {
    expect(validateDeveloperTokenName('  CI integration  ')).toEqual({ ok: true, value: 'CI integration' });
    expect(validateDeveloperTokenName('')).toEqual(expect.objectContaining({ ok: false }));
    expect(validateDeveloperTokenName('x'.repeat(81)).ok).toBe(false);
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(validateDeveloperTokenExpiry(null, now)).toEqual({ ok: true, value: null });
    expect(validateDeveloperTokenExpiry('2026-08-09T00:00:00.000Z', now)).toEqual({
      ok: true, value: new Date('2026-08-09T00:00:00.000Z'),
    });
    expect(validateDeveloperTokenExpiry('2026-08-07T00:00:00.000Z', now).ok).toBe(false);
    expect(validateDeveloperTokenExpiry('2028-01-01T00:00:00.000Z', now).ok).toBe(false);
  });
});
