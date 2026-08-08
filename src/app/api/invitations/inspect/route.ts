import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { hashInvitationToken, validateInvitationToken } from '@/lib/team-invitations';

const unavailable = () => NextResponse.json(
  { error: 'Invitation unavailable' },
  { status: 404, headers: { 'Cache-Control': 'no-store' } },
);

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function POST(req: Request) {
  const originError = requireDashboardOrigin(req);
  if (originError) return originError;
  const limit = consume(`invite:inspect:${clientIp(req)}`, { maxTokens: 30, refillRate: 0.5 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return unavailable();
  }
  const token = validateInvitationToken(body.token);
  if (!token.ok) return unavailable();
  const invitation = await prisma.teamInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token.value) },
    include: {
      team: {
        include: {
          workspace: {
            select: {
              id: true, name: true, brandName: true, logoUrl: true,
              accentColor: true, reviewerWelcome: true,
            },
          },
        },
      },
      project: { select: { id: true, name: true } },
    },
  });
  if (
    !invitation
    || invitation.acceptedAt
    || invitation.revokedAt
    || invitation.expiresAt.getTime() <= Date.now()
  ) {
    return unavailable();
  }
  return NextResponse.json(
    {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      workspace: invitation.team.workspace,
      team: { id: invitation.team.id, name: invitation.team.name },
      project: invitation.project,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
