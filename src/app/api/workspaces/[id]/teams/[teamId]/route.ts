// /api/workspaces/[id]/teams/[teamId]
//
// Per-team operations: rename (PATCH) and delete (DELETE). The FK
// on Project.teamId is `Restrict`, so Prisma would refuse the
// delete anyway with a P2003 conflict; the pre-check below
// surfaces a human-readable "N active projects" count + 409 before
// the opaque Prisma error does. Same belt-and-suspenders pattern
// as the workspace-delete route.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { validateTeamName, validateUuidParam } from '@/lib/validation';

async function findTeam(workspaceId: string, teamId: string) {
  return prisma.team.findFirst({
    where: { id: teamId, workspaceId },
    include: { _count: { select: { projects: true, members: true } } },
  });
}

export async function PATCH(
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

    const body = await req.json();
    const { name } = body as { name?: unknown };
    const nameRes = validateTeamName(name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });

    const existing = await findTeam(widRes.value, tidRes.value);
    if (!existing) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const team = await prisma.team.update({
      where: { id: tidRes.value },
      data: { name: nameRes.value },
    });
    audit({ actor: team.id, action: 'team.update', target: team.id, metadata: { name: team.name } });
    return NextResponse.json(team);
  } catch (error) {
    console.error('Team update error:', error);
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
}

export async function DELETE(
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

    const existing = await findTeam(widRes.value, tidRes.value);
    if (!existing) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    if (existing._count.projects > 0) {
      return NextResponse.json(
        { error: `Team has ${existing._count.projects} active project(s); move or delete them first` },
        { status: 409 }
      );
    }

    await prisma.team.delete({ where: { id: tidRes.value } });
    audit({ actor: tidRes.value, action: 'team.delete', target: tidRes.value, metadata: { workspaceId: widRes.value, name: existing.name } });
    return NextResponse.json({ deleted: true, id: tidRes.value });
  } catch (error) {
    console.error('Team delete error:', error);
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
}
