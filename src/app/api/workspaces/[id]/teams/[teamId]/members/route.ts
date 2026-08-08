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
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertTeamRole } from '@/lib/teams';
import { validateUuidParam } from '@/lib/validation';

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
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  const { id, teamId } = await params;
  const widRes = validateUuidParam(id, 'id');
  if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
  const tidRes = validateUuidParam(teamId, 'teamId');
  if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });

  const access = await assertTeamRole(widRes.value, tidRes.value, ['owner']);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

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
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  const { id, teamId } = await params;
  try {
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });

    const access = await assertTeamRole(widRes.value, tidRes.value, ['owner']);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const team = await findTeam(widRes.value, tidRes.value);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    return NextResponse.json(
      { error: 'Use the managed invitation endpoint to add members' },
      { status: 409 },
    );
  } catch (error) {
    console.error('TeamMember invite error:', error);
    return NextResponse.json({ error: 'Failed to invite team member' }, { status: 500 });
  }
}
