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
import { requireDashboardSession } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { validateTeamName, validateUuidParam } from '@/lib/validation';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  const { id } = await params;
  const idRes = validateUuidParam(id, 'id');
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  // Verify the workspace exists. Without this, findMany would just
  // return [] and the caller would have no signal that the workspace
  // is missing vs. legitimately empty.
  const workspace = await prisma.workspace.findUnique({
    where: { id: idRes.value },
    select: { id: true },
  });
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const teams = await prisma.team.findMany({
    where: { workspaceId: idRes.value },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: { members: true, projects: true },
      },
    },
  });

  return NextResponse.json(
    teams.map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      name: t.name,
      memberCount: t._count.members,
      projectCount: t._count.projects,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const idRes = validateUuidParam(id, 'id');
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const origin = req.headers.get('origin') ?? 'unknown';
    const rateCheck = consume(`teams:origin:${origin}:${idRes.value}`, { maxTokens: 30, refillRate: 0.5 });
    if (!rateCheck.ok) {
      return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
    }

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
