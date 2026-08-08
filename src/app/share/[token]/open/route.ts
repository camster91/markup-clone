import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { consume } from '@/lib/rate-limit';
import {
  createShareAccessValue,
  isShareExpired,
  shareAccessCookieName,
  shareAccessMaxAge,
} from '@/lib/share-access';
import { parseHost } from '@/lib/origin';

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Context = { params: Promise<{ token: string }> };

function notFoundResponse() {
  return NextResponse.json(
    { error: 'Share link not found' },
    { status: 404, headers: { 'Referrer-Policy': 'no-referrer' } }
  );
}

function redirectToReview(_req: Request, token: string, suffix = '', status = 307) {
  return NextResponse.redirect(
    new URL(`/share/${token}${suffix}`, parseHost(process.env.DASHBOARD_HOST).origin),
    status
  );
}

async function findActiveShare(token: string) {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const project = await prisma.project.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      shareToken: true,
      shareExpiresAt: true,
      sharePasswordHash: true,
    },
  });
  return project && !isShareExpired(project.shareExpiresAt) ? project : null;
}

function setAccessCookie(
  response: NextResponse,
  token: string,
  passwordHash: string | null,
  expiresAt: Date | null
) {
  const maxAge = shareAccessMaxAge(expiresAt);
  response.cookies.set(shareAccessCookieName(token), createShareAccessValue(token, passwordHash), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
  });
  response.headers.set('Referrer-Policy', 'no-referrer');
}

export async function GET(req: Request, { params }: Context) {
  const { token } = await params;
  const project = await findActiveShare(token);
  if (!project) return notFoundResponse();

  const response = redirectToReview(req, token);
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (!project.sharePasswordHash) {
    setAccessCookie(response, token, null, project.shareExpiresAt);
  }
  return response;
}

export async function POST(req: Request, { params }: Context) {
  const { token } = await params;
  const project = await findActiveShare(token);
  if (!project) return notFoundResponse();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const fingerprint = shareAccessCookieName(token).slice('markup.share.'.length);
  const limits = [
    consume(`share-open:ip:${ip}`, { maxTokens: 10, refillRate: 0.1 }),
    consume(`share-open:token:${fingerprint}`, { maxTokens: 10, refillRate: 0.1 }),
  ];
  const limited = limits.find((result) => !result.ok);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many attempts' },
      {
        status: 429,
        headers: {
          'Retry-After': String(limited.retryAfterSec),
          'Referrer-Policy': 'no-referrer',
        },
      }
    );
  }

  let password = '';
  try {
    const form = await req.formData();
    const value = form.get('password');
    if (typeof value === 'string') password = value;
  } catch {
    // Do not log form content because it may contain a client password.
    console.warn('Share unlock form body could not be parsed');
  }

  if (!project.sharePasswordHash || !verifyPassword(password, project.sharePasswordHash)) {
    const response = redirectToReview(req, token, '?error=invalid', 303);
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }

  const response = redirectToReview(req, token, '', 303);
  setAccessCookie(response, token, project.sharePasswordHash, project.shareExpiresAt);
  return response;
}
