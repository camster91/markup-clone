// Double-submit CSRF token helpers for dashboard state-changing routes.
//
// Origin checks alone are CSRF-fragile (and forgeable from non-browser
// clients). Pairing them with a double-submit cookie means a cross-site
// form/script that can trigger a same-site cookie send still cannot
// forge the matching header value (SameSite=Strict on the session
// cookie already blocks most of this; CSRF is defense-in-depth).
//
// Contract:
//   - Cookie `markup.csrf` holds a random token (readable by JS).
//   - Header `X-CSRF-Token` must equal that cookie value on every
//     POST / PATCH / DELETE under the dashboard origin.
//   - Issue the cookie on authenticated dashboard GETs (or login).
//   - Missing or mismatched token → 403.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf-constants';

export { CSRF_COOKIE, CSRF_HEADER };

const CSRF_TTL_SECONDS = 7 * 24 * 60 * 60; // match session TTL

/** Generate a fresh CSRF token (32 bytes, base64url). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Ensure a CSRF cookie is present. Returns the token value so the
 * caller can also echo it in a response header if desired.
 */
export async function ensureCsrfCookie(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE)?.value;
  if (existing && existing.length >= 16) return existing;

  const token = generateCsrfToken();
  store.set(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by JS to set the header
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CSRF_TTL_SECONDS,
  });
  return token;
}

/**
 * Verify double-submit CSRF. Returns a 403 NextResponse on failure,
 * or null when the cookie and header match.
 *
 * Safe to call on GETs too (no-op allow) — callers should only invoke
 * this on state-changing methods.
 */
export function requireCsrfToken(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return null;
  }

  const headerToken = req.headers.get(CSRF_HEADER);
  // Cookie header may contain multiple cookies; parse markup.csrf.
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`)
  );
  const cookieToken = match?.[1] ? decodeURIComponent(match[1]) : null;

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  return null;
}
