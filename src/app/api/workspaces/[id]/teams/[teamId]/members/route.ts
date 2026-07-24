// /api/workspaces/[id]/teams/[teamId]/members
//
// TeamMember CRUD. A TeamMember row ties a User (or, at invite time,
// just an email) to a Team with a role. The `userId` FK is nullable —
// an invited member carries only the email + role until the user
// signs up and the row is back-filled with their userId.
//
// Contract:
//   GET    /api/workspaces/[id]/teams/[teamId]/members
//         — list every member of the team
//   POST   /api/workspaces/[id]/teams/[teamId]/members
//         — invite a member by email; optional `userId` to attach an
//           existing user directly
//   PATCH  /api/workspaces/[id]/teams/[teamId]/members/[memberId]
//         — change role
//   DELETE /api/workspaces/[id]/teams/[teamId]/members/[memberId]
//         — remove a member
//
// The PATCH and DELETE operations live on the per-member route (see
// ./[memberId]/route.ts). This file owns the list + invite surface
// because those are the two most common dashboard interactions.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import {
  validateTeamRole,
  validateTeamMemberEmail,
  validateUuidParam,
} from '@/lib/validation';

async function findTeam(workspaceId: string, teamId: string) {
  return prisma.team.findFirst({
    where: { id: teamId, workspaceId },
    select: { id: true, name: true, workspaceId: true },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  const { id, teamId } = await params;
  const widRes = validateUuidParam(id, 'id');
  if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
  const tidRes = validateUuidParam(teamId, 'teamId');
  if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });

  const team = await findTeam(widRes.value, tidRes.value);
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const members = await prisma.teamMember.findMany({
    where: { teamId: tidRes.value },
    orderBy: { createdAt: 'asc' },
    include: {
      // Surface the User's email / role / id (when present) so the
      // dashboard's member list can render the linked-account state
      // (e.g. "Invited" vs "Active") without a follow-up lookup.
      user: { select: { id: true, email: true, role: true } },
    },
  });

  return NextResponse.json(
    members.map((m) => ({
      id: m.id,
      teamId: m.teamId,
      // The denormalized email (captured at invite time) is the
      // single source of truth for "who was invited". The user's
      // current email (when userId is set) may differ if they
      // changed it after signing up — we surface both so the
      // dashboard can show "Invited as X, now logged in as Y" if
      // needed.
      email: m.email,
      role: m.role,
      userId: m.userId,
      user: m.user,
      createdAt: m.createdAt,
    }))
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id, teamId } = await params;
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });

    const origin = req.headers.get('origin') ?? 'unknown';
    const rateCheck = consume(`members:origin:${origin}:${tidRes.value}`, { maxTokens: 30, refillRate: 0.5 });
    if (!rateCheck.ok) {
      return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
    }

    const team = await findTeam(widRes.value, tidRes.value);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const body = await req.json();
    const { email, role, userId } = body as {
      email?: unknown;
      role?: unknown;
      userId?: unknown;
    };
    const emailRes = validateTeamMemberEmail(email);
    if (!emailRes.ok) return NextResponse.json({ error: emailRes.error }, { status: 400 });

    // Role is optional; default 'reviewer'. Validate when supplied.
    let roleValue: 'owner' | 'reviewer' = 'reviewer';
    if (role !== undefined) {
      const roleRes = validateTeamRole(role);
      if (!roleRes.ok) return NextResponse.json({ error: roleRes.error }, { status: 400 });
      roleValue = roleRes.value;
    }

    // userId is optional. When supplied, validate UUID + verify
    // the user exists. We don't auto-link by email (e.g. set userId
    // = the matching User's id when one is found); the explicit
    // userId is the only accepted linkage. A follow-up "claim
    // invite" flow can back-fill the userId when the user signs up.
    let userIdValue: string | null = null;
    if (userId !== undefined && userId !== null) {
      const uidRes = validateUuidParam(userId, 'userId');
      if (!uidRes.ok) return NextResponse.json({ error: uidRes.error }, { status: 400 });
      const user = await prisma.user.findUnique({ where: { id: uidRes.value }, select: { id: true } });
      if (!user) return NextResponse.json({ error: 'userId not found' }, { status: 400 });
      userIdValue = user.id;
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId: tidRes.value,
        userId: userIdValue,
        role: roleValue,
        email: emailRes.value,
      },
    });
    audit({
      actor: member.id,
      action: 'team_member.invite',
      target: member.id,
      metadata: { teamId: tidRes.value, email: member.email, role: member.role, userId: userIdValue },
    });
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    console.error('TeamMember invite error:', error);
    return NextResponse.json({ error: 'Failed to invite team member' }, { status: 500 });
  }
}
