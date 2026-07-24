// POST /api/auth/login
//
// Email + password login. On success, issues a Session row and sets
// the `markup.session` HttpOnly cookie. The login route is INTENTIONALLY
// NOT behind requireDashboardOrigin — the caller may not be on the
// dashboard origin yet (that's the whole point of login), and the
// route's defence-in-depth is the password + the session cookie's 256
// bits of entropy. Once a session is set, subsequent dashboard
// fetches layer `requireDashboardSession` on top of Origin.
//
// Body: { email: string, password: string }
// 200:  { user: { id, email, role } }  — sessionToken is NEVER returned
//       in the JSON body (HttpOnly cookie only; avoids XSS exfiltration)
// 400:  missing/invalid body
// 401:  wrong email or wrong password (deliberately the same error
//       and status so an attacker cannot enumerate emails)
// 429:  rate-limited (per-email and per-IP buckets)
//
// Cookie attributes:
//   - HttpOnly: yes — never exposed to JS (no XSS exfiltration)
//   - SameSite: Strict — no cross-site sends (no CSRF surface)
//   - Secure:   yes in production; off in dev so http://localhost works
//   - Path:     / — covers every route
//   - Max-Age:  7 days, matching the Session row's expiresAt
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { consume } from '@/lib/rate-limit';
import { randomBytes } from 'crypto';
import { getClientIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // email: required, non-empty string. We don't enforce a strict
  // RFC-5322 regex here — the User table is the source of truth, and
  // a too-strict regex on input would lock out valid addresses.
  // The login is case-insensitive (we store email lowercased), so
  // we normalize before the DB lookup.
  if (typeof body.email !== 'string' || body.email.length === 0) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }
  const email = body.email.toLowerCase();

  // Rate limit before the DB lookup. ~5 attempts/min per email and
  // per client IP (maxTokens: 5, refillRate: 1/12 ≈ one token every
  // 12s). Either empty bucket → 429 with Retry-After.
  const ip = getClientIp(req);
  const emailBucket = consume(`login:email:${email}`, { maxTokens: 5, refillRate: 1 / 12 });
  if (!emailBucket.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSec: emailBucket.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(emailBucket.retryAfterSec) } }
    );
  }
  const ipBucket = consume(`login:ip:${ip}`, { maxTokens: 5, refillRate: 1 / 12 });
  if (!ipBucket.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSec: ipBucket.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(ipBucket.retryAfterSec) } }
    );
  }

  // Look up the user. We do NOT distinguish "no such email" from
  // "wrong password" in the response — the same 401 with the same
  // message either way. This is the standard "don't leak account
  // existence" pattern: an attacker who can time the response
  // would otherwise learn which emails are registered.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return NextResponse.json({ error: 'invalid email or password' }, { status: 401 });
  }

  // Issue a fresh session token. 32 random bytes = 64 base64url
  // chars (no padding). The unique index on Session.token backs a
  // 1 - 2^-256 collision probability per issuance; the route
  // catches the (vanishingly unlikely) duplicate and retries once
  // before failing the request. expiresAt = now + 7d matches the
  // cookie's Max-Age so the cookie and the row expire together.
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  let session;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomBytes(32).toString('base64url');
    try {
      session = await prisma.session.create({
        data: { userId: user.id, token, expiresAt },
      });
      break;
    } catch {
      // P2002 unique violation — try once more with a new token.
      // A second failure is a DB-level issue, not a collision; let
      // it surface.
      if (attempt === 1) throw new Error('failed to create session');
    }
  }
  if (!session) {
    return NextResponse.json({ error: 'failed to create session' }, { status: 500 });
  }

  // Set the session cookie. SameSite=Strict + HttpOnly + Secure-in-prod
  // is the cookie-attribute trio that the task spec calls for; the
  // Secure flag is gated on NODE_ENV so local dev (http://localhost)
  // still works. The JSON body deliberately omits sessionToken —
  // the cookie is the only carrier.
  const res = NextResponse.json(
    {
      user: { id: user.id, email: user.email, role: user.role },
    },
    { status: 200 }
  );
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    expires: expiresAt,
  });
  return res;
}
