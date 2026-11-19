// First-operator setup for an empty install (Cloudflare empty-D1 relaunch).
// GET returns { needed: true } only when the User table is empty.
// POST creates the first operator and issues a session, then refuses further
// calls once any user exists.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { consume } from '@/lib/rate-limit';
import { ensureCsrfCookie } from '@/lib/csrf';
import { getClientIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic';

const MAX_LOGIN_EMAIL_LENGTH = 254;

async function isEmptyInstall(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

export async function GET() {
  return NextResponse.json({ needed: await isEmptyInstall() });
}

export async function POST(req: Request) {
  if (!(await isEmptyInstall())) {
    return NextResponse.json({ error: 'setup is not available' }, { status: 403 });
  }

  const ip = getClientIp(req);
  const limit = consume(`setup:${ip}`, { maxTokens: 5, refillRate: 0.1 });
  if (!limit.ok) {
    return NextResponse.json({ error: 'too many attempts' }, { status: 429 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > MAX_LOGIN_EMAIL_LENGTH || !email.includes('@') || /[\u0000-\u001f\u007f\s]/.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  if (password.length < 12 || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
    return NextResponse.json({ error: 'password must be 12 to 128 characters' }, { status: 400 });
  }

  // Recheck emptiness inside the create path to close a narrow race.
  if (!(await isEmptyInstall())) {
    return NextResponse.json({ error: 'setup is not available' }, { status: 403 });
  }

  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), role: 'operator' },
    select: { id: true, email: true, role: true },
  });

  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: { userId: user.id, token, expiresAt },
  });

  await ensureCsrfCookie();
  const res = NextResponse.json({ user }, { status: 201 });
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
