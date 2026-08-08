// /api/workspaces/[id]/teams
//
// Team CRUD scoped to a workspace. A Team lives inside exactly one
// Workspace (FK on Team.workspaceId, Cascade on delete). The list
// returns every team in the workspace with member + project counts;
// the create handler inserts a new team under the workspace.
//
// Contract:
//   GET  /api/workspaces/[id]/teams   — every team in the workspace
//   POST /api/workspaces/[id]/teams   — create a team, name required
//   PATCH /api/workspaces/[id]/teams/[teamId]
//                                     — rename
//   DELETE /api/workspaces/[id]/teams/[teamId]
//                                     — remove (refuses if the team
//                                       still owns projects)
//
// The list and create operations are deliberately tiny (one model
// each) so the per-workspace detail page can compose them with
// member-list calls. A future "with members" eager-load is a small
// follow-up once the dashboard needs it.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateTeamName, validateUuidParam } from '@/lib/validation';
import {
  assertOperator,
  getCallerUser,
  getWorkspaceScopeWhere,
  normalizeTeamRole,
} from '@/lib/teams';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  const idRes = validateUuidParam(id, 'id');
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  const caller = await getCallerUser();
  if (!caller) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 403 });
  }

  // Verify the workspace is both present and visible to the caller.
  const workspace = await prisma.workspace.findFirst({
    where: { AND: [{ id: idRes.value }, getWorkspaceScopeWhere(caller)] },
    select: { id: true },
  });
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const teams = await prisma.team.findMany({
    where:
      caller.role === 'operator'
        ? { workspaceId: idRes.value }
        : {
            workspaceId: idRes.value,
            members: { some: { userId: caller.id } },
          },
    orderBy: { createdAt: 'asc' },
    include: {
      members: {
        where: { userId: caller.id },
        select: { role: true, projectId: true },
      },
      _count: {
        select: { members: true, projects: true },
      },
    },
  });

  return NextResponse.json(
    teams.map((t) => {
      const membershipRole = normalizeTeamRole(t.members[0]?.role);
      const isGuest = caller.role !== 'operator' && membershipRole === 'guest';
      const canSeeMemberCount = caller.role === 'operator' || membershipRole === 'owner';
      return {
        id: t.id,
        workspaceId: t.workspaceId,
        name: t.name,
        memberCount: canSeeMemberCount ? t._count.members : undefined,
        projectCount: isGuest ? 1 : t._count.projects,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    })
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  const access = await assertOperator();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const { id } = await params;
    const idRes = validateUuidParam(id, 'id');
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const body = await req.json();
    const { name } = body as { name?: unknown };
    const nameRes = validateTeamName(name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });

    const workspace = await prisma.workspace.findUnique({
      where: { id: idRes.value },
      select: { id: true },
    });
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const team = await prisma.team.create({
      data: { workspaceId: idRes.value, name: nameRes.value },
    });
    audit({ actor: team.id, action: 'team.create', target: team.id, metadata: { workspaceId: team.workspaceId, name: team.name } });
    return NextResponse.json(team, { status: 201 });
  } catch (error) {
    console.error('Team create error:', error);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
