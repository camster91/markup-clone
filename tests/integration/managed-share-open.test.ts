import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareAccessValue, shareAccessCookieName } from '@/lib/share-access';
import { _resetBucket } from '@/lib/rate-limit';

const TOKEN = 'a'.repeat(43);
const PASSWORD_HASH = 'scrypt$test-hash';

const mocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/password', () => ({
  verifyPassword: vi.fn((plain: string, stored: string) =>
    plain === 'Correct client password' && stored === 'scrypt$test-hash'),
}));

import { GET, POST } from '@/app/share/[token]/open/route';

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shareToken: TOKEN,
    shareExpiresAt: new Date('2026-08-15T12:00:00.000Z'),
    sharePasswordHash: null,
    ...overrides,
  };
}

function openRequest(method: 'GET' | 'POST', password?: string) {
  const body = password === undefined
    ? undefined
    : new URLSearchParams({ password }).toString();
  return new Request(`https://markup.ashbi.ca/share/${TOKEN}/open`, {
    method,
    headers: {
      'x-forwarded-for': '203.0.113.25',
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
  _resetBucket('share-open:ip:203.0.113.25');
  _resetBucket(`share-open:token:${shareAccessCookieName(TOKEN).slice('markup.share.'.length)}`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('managed public review opener', () => {
  it('bootstraps an unprotected link into a token-bound HttpOnly cookie', async () => {
    mocks.project.findUnique.mockResolvedValue(project());
    const response = await GET(openRequest('GET'), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`https://markup.ashbi.ca/share/${TOKEN}`);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${shareAccessCookieName(TOKEN)}=${createShareAccessValue(TOKEN, null)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toContain(TOKEN);
  });

  it('does not issue access from GET when the link is password protected', async () => {
    mocks.project.findUnique.mockResolvedValue(project({ sharePasswordHash: PASSWORD_HASH }));
    const response = await GET(openRequest('GET'), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBe(`https://markup.ashbi.ca/share/${TOKEN}`);
  });

  it('unlocks a protected link with the correct password and rotates with hash state', async () => {
    mocks.project.findUnique.mockResolvedValue(project({ sharePasswordHash: PASSWORD_HASH }));
    const response = await POST(openRequest('POST', 'Correct client password'), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain(
      `${shareAccessCookieName(TOKEN)}=${createShareAccessValue(TOKEN, PASSWORD_HASH)}`
    );
  });

  it('returns the same safe form redirect for an incorrect password', async () => {
    mocks.project.findUnique.mockResolvedValue(project({ sharePasswordHash: PASSWORD_HASH }));
    const response = await POST(openRequest('POST', 'Incorrect password'), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `https://markup.ashbi.ca/share/${TOKEN}?error=invalid`
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rate-limits repeated password guesses by IP and token fingerprint', async () => {
    mocks.project.findUnique.mockResolvedValue(project({ sharePasswordHash: PASSWORD_HASH }));
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await POST(openRequest('POST', 'Incorrect password'), {
        params: Promise.resolve({ token: TOKEN }),
      });
      expect(response.status).toBe(303);
    }
    const limited = await POST(openRequest('POST', 'Incorrect password'), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('10');
    expect(limited.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    [null],
    [project({ shareExpiresAt: new Date('2026-08-08T11:59:59.000Z') })],
  ])('returns an indistinguishable 404 for a missing or expired link', async (row) => {
    mocks.project.findUnique.mockResolvedValue(row);
    const response = await GET(openRequest('GET'), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
