// POST /api/auth/logout
//
// Clears the current session. Idempotent: if no session cookie is
// present, or the cookie's token does not match any row, the route
// still returns 200 with a cleared cookie — the user-visible
// outcome (no session) is achieved either way.
//
// The DB delete is best-effort: if the row was already removed
// (e.g. another tab logged out), the route swallows the "not
// found" error and continues to clear the cookie. The cookie
// attribute set (Max-Age=0) is what actually invalidates the
// session on the client — even if the DB row lingers, the
// browser will not send the cookie back.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Read the current cookie. `cookies()` is async in Next.js 15+;
  // a missing cookie is the common case (already logged out) and
  // we treat it as success.
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    // Outside a request scope (shouldn't happen for a route
    // handler, but be defensive) — return a cleared cookie and
    // 200 anyway.
  }

  if (token) {
    // Best-effort delete. P2025 (record not found) is fine — the
    // goal is "this token is no longer valid", and the cookie
    // clear below achieves that on the client side.
    try {
      await prisma.session.delete({ where: { token } });
    } catch (err: unknown) {
      // Prisma's "not found" is a P2025; treat as success.
      // Re-throw anything else so a real DB outage surfaces.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code !== 'P2025'
      ) {
        throw err;
      }
    }
  }

  // Clear the cookie. The browser is the source of truth for
  // "is the session still active" — even if a stray row exists
  // server-side, an HttpOnly cookie with Max-Age=0 is what
  // stops the browser from sending it on the next request.
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}
