// /api/workspaces/[id]/teams/[teamId]/members/[memberId]
//
// Per-member operations: change role (PATCH) and remove (DELETE).
// Adding a new member is on the parent route; this file owns the
// lifecycle of a single existing row.
//
// The triple-UUID URL pattern (workspace / team / member) is verbose
// but the alternatives all leak the wrong info: a `/members/[id]`
// route would either let a caller guess member ids across teams, or
// force an extra server-side lookup to scope. The nested form makes
// the scope explicit at the route signature level.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertTeamRole } from '@/lib/teams';
import { validateTeamRole, validateUuidParam } from '@/lib/validation';

async function findMember(workspaceId: string, teamId: string, memberId: string) {
  return prisma.teamMember.findFirst({
    where: {
      id: memberId,
      teamId,
      team: { workspaceId },
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string; memberId: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id, teamId, memberId } = await params;
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
    const midRes = validateUuidParam(memberId, 'memberId');
    if (!midRes.ok) return NextResponse.json({ error: midRes.error }, { status: 400 });

    const access = await assertTeamRole(widRes.value, tidRes.value, ['owner']);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await req.json();
    const { role, projectId } = body as { role?: unknown; projectId?: unknown };
    const roleRes = validateTeamRole(role);
    if (!roleRes.ok) return NextResponse.json({ error: roleRes.error }, { status: 400 });

    const existing = await findMember(widRes.value, tidRes.value, midRes.value);
    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    let projectIdValue: string | null = null;
    if (roleRes.value === 'guest') {
      const projectRes = validateUuidParam(projectId, 'projectId');
      if (!projectRes.ok) return NextResponse.json({ error: projectRes.error }, { status: 400 });
      const project = await prisma.project.findFirst({
        where: { id: projectRes.value, teamId: tidRes.value },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json({ error: 'Guest project must belong to this team' }, { status: 400 });
      }
      projectIdValue = project.id;
    } else if (projectId !== undefined && projectId !== null) {
      return NextResponse.json({ error: 'Only guests may select a project' }, { status: 400 });
    }

    if (existing.role === 'owner' && roleRes.value !== 'owner' && existing.userId) {
      const ownerCount = await prisma.teamMember.count({
        where: { teamId: tidRes.value, role: 'owner', userId: { not: null } },
      });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: 'A team must keep at least one owner' }, { status: 409 });
      }
    }

    const member = await prisma.teamMember.update({
      where: { id: midRes.value },
      data: { role: roleRes.value, projectId: projectIdValue },
    });
    audit({
      actor: access.caller.id,
      action: 'team_member.update',
      target: member.id,
      metadata: { teamId: tidRes.value, role: member.role },
    });
    return NextResponse.json(member);
  } catch (error) {
    console.error('TeamMember update error:', error);
    return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string; memberId: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id, teamId, memberId } = await params;
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
    const midRes = validateUuidParam(memberId, 'memberId');
    if (!midRes.ok) return NextResponse.json({ error: midRes.error }, { status: 400 });

    const access = await assertTeamRole(widRes.value, tidRes.value, ['owner']);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const existing = await findMember(widRes.value, tidRes.value, midRes.value);
    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    if (existing.role === 'owner' && existing.userId) {
      const ownerCount = await prisma.teamMember.count({
        where: { teamId: tidRes.value, role: 'owner', userId: { not: null } },
      });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: 'A team must keep at least one owner' }, { status: 409 });
      }
    }

    await prisma.teamMember.delete({ where: { id: midRes.value } });
    audit({
      actor: access.caller.id,
      action: 'team_member.remove',
      target: midRes.value,
      metadata: { teamId: tidRes.value, email: existing.email, role: existing.role },
    });
    return NextResponse.json({ deleted: true, id: midRes.value });
  } catch (error) {
    console.error('TeamMember delete error:', error);
    return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
  }
}
