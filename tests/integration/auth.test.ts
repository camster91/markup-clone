// Integration tests for the /api/auth/* routes — per-user identity.
//
// What this file pins down:
//
//   1) POST /api/auth/login with valid creds returns 200 + session,
//      sets the HttpOnly cookie, and creates a Session row with the
//      correct user/expiresAt.
//   2) POST /api/auth/login with invalid creds returns 401 and
//      creates NO session row.
//   3) GET /api/auth/me with a valid session returns the user.
//   4) GET /api/auth/me without a session returns 401.
//   5) POST /api/auth/logout clears the session row + cookie.
//   6) requireAuth() returns null for an unknown / invalid token.
//
// Prisma is mocked at the module level so the tests can assert the
// exact prisma calls. The session/cookie round-trip is end-to-end:
// the route parses the body, hashes/verifies with src/lib/password,
// calls prisma, and sets/clears the HttpOnly cookie via NextResponse.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

// Stub cookies() (next/headers) so the route handler can read+write
// the session cookie in tests. The stub holds the cookie value in
// a module-level variable and surfaces get/set on the returned
// object — the same shape Next.js' cookies() returns. The `name`
// argument is part of the Next.js cookies() contract; the stub
// echoes it back in `get` so the return value matches the real
// `RequestCookies.get(name)` shape.
const cookieStore = vi.hoisted(() => {
  const data: { value?: string } = {};
  return {
    data,
    get: (name: string) => (data.value !== undefined ? { name, value: data.value } : undefined),
    set: (name: string, value: string) => {
      // The cookie's `name` arg is part of the cookies() contract;
      // we echo it back in the parsed value but the test stub
      // only ever stores one value at a time.
      void name;
      if (value === '' || value === undefined) data.value = undefined;
      else data.value = value;
    },
    delete: (name: string) => {
      void name;
      data.value = undefined;
    },
    has: (name: string) => {
      void name;
      return data.value !== undefined;
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { POST as loginPOST } from '../../src/app/api/auth/login/route';
import { POST as logoutPOST } from '../../src/app/api/auth/logout/route';
import { GET as meGET } from '../../src/app/api/auth/me/route';
import { requireAuth } from '../../src/lib/auth';
import { _resetBucket } from '../../src/lib/rate-limit';
import { NextRequest } from 'next/server';
import { hashPassword } from '../../src/lib/password';

const VALID_HASH = hashPassword('correct-password');

function loginReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.data.value = undefined;
  // Reset login rate-limit buckets so earlier tests don't starve
  // later ones (maxTokens 10 across the whole file).
  _resetBucket('login:ip:unknown');
  _resetBucket('login:email:alice@example.com');
  _resetBucket('login:email:nobody@example.com');
  // Default user row — individual tests override as needed.
  mocks.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => {
    if (where.email === 'alice@example.com') {
      return {
        id: 'user-1',
        email: 'alice@example.com',
        passwordHash: VALID_HASH,
        role: 'operator',
        createdAt: new Date(),
      };
    }
    return null;
  });
  // Default session create: returns a row mirroring the input data.
  mocks.session.create.mockImplementation(async ({ data }: { data: { token: string; userId: string; expiresAt: Date } }) => ({
    id: 'session-1',
    userId: data.userId,
    token: data.token,
    expiresAt: data.expiresAt,
    createdAt: new Date(),
  }));
  // Default session findUnique: returns a row whose user is the
  // default operator above. Tests that need a missing or expired
  // session override this.
  mocks.session.findUnique.mockImplementation(async ({ where }: { where: { token: string } }) => {
    if (where.token === 'good-token') {
      return {
        id: 'session-1',
        userId: 'user-1',
        token: 'good-token',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        user: { id: 'user-1', email: 'alice@example.com', role: 'operator' },
      };
    }
    return null;
  });
  // Default session delete: behaves like a successful Prisma delete.
  mocks.session.delete.mockResolvedValue({ id: 'session-1' });
});

describe('POST /api/auth/login — valid creds', () => {
  it('returns 200 with the user (no sessionToken in body), sets the cookie', async () => {
    const res = await loginPOST(loginReq({ email: 'alice@example.com', password: 'correct-password' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 'user-1', email: 'alice@example.com', role: 'operator' });
    // Session token must be cookie-only — never returned in JSON
    // (XSS would otherwise exfiltrate it from the response body).
    expect(body.sessionToken).toBeUndefined();

    // The response must set the HttpOnly session cookie. Next.js'
    // response.cookies stores the value on the response object;
    // the test asserts the cookie is present and HttpOnly.
    const setCookie = res.cookies.get('markup.session');
    expect(setCookie).toBeDefined();
    expect(setCookie?.value).toBeTruthy();
    expect(setCookie?.value.length).toBeGreaterThan(20);
    expect(setCookie?.httpOnly).toBe(true);
  });

  it('looks up the user by lowercased email (login is case-insensitive)', async () => {
    const res = await loginPOST(loginReq({ email: 'Alice@Example.COM', password: 'correct-password' }));
    expect(res.status).toBe(200);
    expect(mocks.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } });
  });

  it('creates a Session row tied to the user, with expiresAt ~7d in the future', async () => {
    const before = Date.now();
    const res = await loginPOST(loginReq({ email: 'alice@example.com', password: 'correct-password' }));
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(mocks.session.create).toHaveBeenCalledTimes(1);
    const call = mocks.session.create.mock.calls[0][0];
    expect(call.data.userId).toBe('user-1');
    // 7 days = 604_800_000 ms. Allow a small drift for the
    // before/after timestamps.
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = (call.data.expiresAt as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + sevenDays - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + sevenDays + 1000);
  });

  it('stores the session token on the Session row (cookie value matches)', async () => {
    const res = await loginPOST(loginReq({ email: 'alice@example.com', password: 'correct-password' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionToken).toBeUndefined();
    const call = mocks.session.create.mock.calls[0][0];
    const setCookie = res.cookies.get('markup.session');
    expect(setCookie?.value).toBe(call.data.token);
  });
});

describe('POST /api/auth/login — invalid creds', () => {
  it('returns 401 when the user does not exist', async () => {
    const res = await loginPOST(loginReq({ email: 'nobody@example.com', password: 'correct-password' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid email or password');
    expect(mocks.session.create).not.toHaveBeenCalled();
  });

  it('returns 401 when the password is wrong', async () => {
    const res = await loginPOST(loginReq({ email: 'alice@example.com', password: 'wrong-password' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid email or password');
    expect(mocks.session.create).not.toHaveBeenCalled();
  });

  it('uses the SAME error message for missing-user vs wrong-password (no enumeration)', async () => {
    const missing = await loginPOST(loginReq({ email: 'nobody@example.com', password: 'correct-password' }));
    const wrong = await loginPOST(loginReq({ email: 'alice@example.com', password: 'wrong-password' }));
    const missingBody = await missing.json();
    const wrongBody = await wrong.json();
    expect(missingBody.error).toBe(wrongBody.error);
    expect(missing.status).toBe(wrong.status);
  });

  it('returns 400 when email is missing', async () => {
    const res = await loginPOST(loginReq({ password: 'x' }));
    expect(res.status).toBe(400);
    expect(mocks.session.create).not.toHaveBeenCalled();
  });

  it('returns 400 when password is missing', async () => {
    const res = await loginPOST(loginReq({ email: 'alice@example.com' }));
    expect(res.status).toBe(400);
    expect(mocks.session.create).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await loginPOST(new NextRequest('https://markup.ashbi.ca/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 200 with the user when a valid session cookie is present', async () => {
    cookieStore.data.value = 'good-token';
    const res = await meGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 'user-1', email: 'alice@example.com', role: 'operator' });
  });

  it('returns 401 when no cookie is present', async () => {
    cookieStore.data.value = undefined;
    const res = await meGET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 401 when the cookie is for a session that does not exist', async () => {
    cookieStore.data.value = 'unknown-token';
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it('returns 401 when the session has expired', async () => {
    cookieStore.data.value = 'good-token';
    mocks.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      userId: 'user-1',
      token: 'good-token',
      expiresAt: new Date(Date.now() - 1000), // already expired
      createdAt: new Date(),
      user: { id: 'user-1', email: 'alice@example.com', role: 'operator' },
    });
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it('looks up the session by the cookie value (uses the unique token index)', async () => {
    cookieStore.data.value = 'good-token';
    const res = await meGET();
    expect(res.status).toBe(200);
    expect(mocks.session.findUnique).toHaveBeenCalledWith({
      where: { token: 'good-token' },
      include: { user: { select: { id: true, email: true, role: true } } },
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and deletes the session row when a session cookie is present', async () => {
    cookieStore.data.value = 'good-token';
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mocks.session.delete).toHaveBeenCalledWith({ where: { token: 'good-token' } });

    // The response must clear the cookie (Max-Age=0 in the
    // production path; the NextResponse API surfaces an empty
    // value when set with maxAge:0).
    const cleared = res.cookies.get('markup.session');
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe('');
  });

  it('returns 200 (idempotent) when no session cookie is present', async () => {
    cookieStore.data.value = undefined;
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    // No session row to delete.
    expect(mocks.session.delete).not.toHaveBeenCalled();
    // The cookie is still cleared (the response always emits a
    // Set-Cookie header, even if there was nothing to clear).
    const cleared = res.cookies.get('markup.session');
    expect(cleared).toBeDefined();
  });

  it('returns 200 (idempotent) when the cookie is for a session that no longer exists', async () => {
    cookieStore.data.value = 'stale-token';
    // Simulate Prisma's "record not found" — the route swallows
    // P2025 and returns success anyway.
    const err: any = new Error('not found');
    err.code = 'P2025';
    mocks.session.delete.mockRejectedValueOnce(err);
    const res = await logoutPOST();
    expect(res.status).toBe(200);
  });
});

describe('requireAuth()', () => {
  it('returns null when the session cookie is missing', async () => {
    cookieStore.data.value = undefined;
    const user = await requireAuth();
    expect(user).toBeNull();
  });

  it('returns null when the session token does not match any row', async () => {
    cookieStore.data.value = 'no-such-token';
    const user = await requireAuth();
    expect(user).toBeNull();
  });

  it('returns null for an expired session', async () => {
    cookieStore.data.value = 'expired-token';
    mocks.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      userId: 'user-1',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      user: { id: 'user-1', email: 'alice@example.com', role: 'operator' },
    });
    const user = await requireAuth();
    expect(user).toBeNull();
  });

  it('returns the user for a valid session', async () => {
    cookieStore.data.value = 'good-token';
    const user = await requireAuth();
    expect(user).toEqual({ id: 'user-1', email: 'alice@example.com', role: 'operator' });
  });
});
