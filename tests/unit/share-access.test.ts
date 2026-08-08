import { describe, expect, it } from 'vitest';
import {
  createShareAccessValue,
  isShareAccessCookieValid,
  isShareExpired,
  parseShareOptions,
  shareAccessCookieName,
  shareAccessMaxAge,
} from '@/lib/share-access';

const NOW = new Date('2026-08-08T12:00:00.000Z');

describe('managed share options', () => {
  it('accepts an omitted body as an unprotected link with no expiry', () => {
    expect(parseShareOptions(undefined, NOW)).toEqual({
      ok: true,
      expiresAt: null,
      password: null,
    });
  });

  it('accepts a bounded future expiry and password without trimming it', () => {
    expect(parseShareOptions({
      expiresAt: '2026-08-15T12:00:00.000Z',
      password: '  client passphrase  ',
    }, NOW)).toEqual({
      ok: true,
      expiresAt: new Date('2026-08-15T12:00:00.000Z'),
      password: '  client passphrase  ',
    });
  });

  it.each([
    [{ expiresAt: 'not-a-date' }, 'expiry must be a valid ISO date'],
    [{ expiresAt: '2026-08-08T11:59:59.000Z' }, 'expiry must be in the future'],
    [{ expiresAt: '2027-08-09T12:00:00.000Z' }, 'expiry cannot be more than 365 days away'],
    [{ password: 'short' }, 'password must be 8 to 128 characters'],
    [{ password: 'x'.repeat(129) }, 'password must be 8 to 128 characters'],
    [{ password: 'valid-pass\u0000' }, 'password cannot contain control characters'],
    [{ password: 42 }, 'password must be a string'],
    ['not-an-object', 'request body must be an object'],
  ])('rejects invalid options %#', (input, error) => {
    expect(parseShareOptions(input, NOW)).toEqual({ ok: false, error });
  });
});

describe('share access cookie', () => {
  const token = 'a'.repeat(43);
  const passwordHash = 'scrypt$16384$8$1$salt$hash';

  it('uses a stable token fingerprint in the cookie name, not the token', () => {
    const name = shareAccessCookieName(token);
    expect(name).toMatch(/^markup\.share\.[a-f0-9]{24}$/);
    expect(name).not.toContain(token);
  });

  it('binds access to both the exact token and password-hash state', () => {
    const value = createShareAccessValue(token, passwordHash);
    expect(isShareAccessCookieValid(token, passwordHash, value)).toBe(true);
    expect(isShareAccessCookieValid(`${token.slice(0, -1)}b`, passwordHash, value)).toBe(false);
    expect(isShareAccessCookieValid(token, `${passwordHash}-rotated`, value)).toBe(false);
    expect(isShareAccessCookieValid(token, passwordHash, `${value}x`)).toBe(false);
  });

  it('also binds an unprotected link without exposing its token', () => {
    const value = createShareAccessValue(token, null);
    expect(value).not.toContain(token);
    expect(isShareAccessCookieValid(token, null, value)).toBe(true);
    expect(isShareAccessCookieValid(token, passwordHash, value)).toBe(false);
  });

  it('enforces database expiry and caps cookie life at seven days', () => {
    expect(isShareExpired(null, NOW)).toBe(false);
    expect(isShareExpired(new Date('2026-08-08T11:59:59Z'), NOW)).toBe(true);
    expect(shareAccessMaxAge(null, NOW)).toBe(7 * 24 * 60 * 60);
    expect(shareAccessMaxAge(new Date('2026-08-09T12:00:00Z'), NOW)).toBe(24 * 60 * 60);
  });
});
