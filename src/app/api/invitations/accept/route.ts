import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  requireDashboardOrigin,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/lib/auth';
import { ensureCsrfCookie } from '@/lib/csrf';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { hashPassword, verifyPassword } from '@/lib/password';
import {
  hashInvitationToken,
  validateInvitationPassword,
  validateInvitationToken,
} from '@/lib/team-invitations';
import { getClientIp } from '@/lib/request-ip';

class InvitationUnavailableError extends Error {}
class ActiveMembershipError extends Error {}

const unavailable = () => NextResponse.json(
  { error: 'Invitation unavailable' },
  { status: 404, headers: { 'Cache-Control': 'no-store' } },
);

export async function POST(req: Request) {
  const originError = requireDashboardOrigin(req);
  if (originError) return originError;
  let body: { token?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return unavailable();
  }
  const token = validateInvitationToken(body.token);
  if (!token.ok) return unavailable();
  const tokenHash = hashInvitationToken(token.value);

  const limit = consume(`invite:accept:${getClientIp(req)}:${tokenHash}`, {
    maxTokens: 10,
    refillRate: 0.1,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const invitation = await prisma.teamInvitation.findUnique({
    where: { tokenHash },
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
  const now = new Date();
  if (
    !invitation
    || invitation.acceptedAt
    || invitation.revokedAt
    || invitation.expiresAt.getTime() <= now.getTime()
  ) {
    return unavailable();
  }

  const sessionUser = await requireAuth();
  if (sessionUser && sessionUser.email.toLowerCase() !== invitation.email) {
    return NextResponse.json(
      { error: 'Sign out and use the invited email address' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const existingUser = sessionUser
    ? null
    : await prisma.user.findUnique({ where: { email: invitation.email } });
  let newPasswordHash: string | null = null;
  if (!sessionUser) {
    const password = validateInvitationPassword(body.password);
    if (!password.ok) {
      return NextResponse.json(
        { error: 'Unable to accept invitation' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (existingUser && !verifyPassword(password.value, existingUser.passwordHash)) {
      return NextResponse.json(
        { error: 'Unable to accept invitation' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!existingUser) newPasswordHash = hashPassword(password.value);
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.teamInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw new InvitationUnavailableError();

      const user = sessionUser ?? existingUser ?? await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash: newPasswordHash!,
          role: 'reviewer',
        },
      });
      const existingMembership = await tx.teamMember.findFirst({
        where: {
          teamId: invitation.teamId,
          OR: [{ userId: user.id }, { userId: null, email: invitation.email }],
        },
      });
      if (existingMembership?.userId) throw new ActiveMembershipError();
      if (existingMembership) {
        await tx.teamMember.update({
          where: { id: existingMembership.id },
          data: {
            userId: user.id,
            email: invitation.email,
            role: invitation.role,
            projectId: invitation.projectId,
          },
        });
      } else {
        await tx.teamMember.create({
          data: {
            teamId: invitation.teamId,
            userId: user.id,
            email: invitation.email,
            role: invitation.role,
            projectId: invitation.projectId,
          },
        });
      }

      if (sessionUser) return { user, session: null };
      const session = await tx.session.create({
        data: {
          userId: user.id,
          token: randomBytes(32).toString('base64url'),
          expiresAt,
        },
      });
      return { user, session };
    });

    await ensureCsrfCookie();
    const redirectTo = invitation.role === 'guest' && invitation.projectId
      ? `/projects/${invitation.projectId}`
      : `/workspaces/${invitation.team.workspace.id}/teams/${invitation.teamId}`;
    const response = NextResponse.json(
      {
        accepted: true,
        redirectTo,
        user: { id: result.user.id, email: result.user.email },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    if (result.session) {
      response.cookies.set(SESSION_COOKIE, result.session.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
        expires: expiresAt,
      });
    }
    audit({
      actor: result.user.id,
      action: 'team_invitation.accept',
      target: invitation.id,
      metadata: {
        teamId: invitation.teamId,
        role: invitation.role,
        projectId: invitation.projectId,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof InvitationUnavailableError) return unavailable();
    if (error instanceof ActiveMembershipError) {
      return NextResponse.json(
        { error: 'Account is already a team member' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('Invitation acceptance failed');
    return NextResponse.json(
      { error: 'Unable to accept invitation' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
