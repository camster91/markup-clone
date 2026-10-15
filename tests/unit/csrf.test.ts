import { describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER, requireCsrfToken, tokensMatch } from '@/lib/csrf';

const TOKEN = 'a'.repeat(43);

function post(headers: Record<string, string>): Request {
  return new Request('https://markup.ashbi.ca/api/projects', { method: 'POST', headers });
}

describe('requireCsrfToken', () => {
  it('accepts a matching markup.csrf cookie and header', () => {
    expect(requireCsrfToken(post({ cookie: `a=1; markup.csrf=${TOKEN}`, [CSRF_HEADER]: TOKEN }))).toBeNull();
  });

  it('does not treat the "." in the cookie name as a regex wildcard', () => {
    const res = requireCsrfToken(post({ cookie: `markupXcsrf=${TOKEN}`, [CSRF_HEADER]: TOKEN }));
    expect(res?.status).toBe(403);
  });

  it('rejects mismatched tokens of equal and different lengths', () => {
    expect(requireCsrfToken(post({ cookie: `markup.csrf=${TOKEN}`, [CSRF_HEADER]: 'b'.repeat(43) }))?.status).toBe(403);
    expect(requireCsrfToken(post({ cookie: `markup.csrf=${TOKEN}`, [CSRF_HEADER]: 'short' }))?.status).toBe(403);
  });

  it('returns 403 (not a thrown URIError) for a malformed cookie encoding', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = requireCsrfToken(post({ cookie: 'markup.csrf=%E0%A4%A', [CSRF_HEADER]: '%E0%A4%A' }));
      expect(res?.status).toBe(403);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('allows safe methods without a token', () => {
    expect(requireCsrfToken(new Request('https://markup.ashbi.ca/', { method: 'GET' }))).toBeNull();
  });
});

describe('tokensMatch', () => {
  it('compares in constant time and handles length / multibyte differences', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
    // Same UTF-16 length, different UTF-8 byte length — must not throw.
    expect(tokensMatch('é', 'e')).toBe(false);
  });
});
