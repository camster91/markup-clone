// /api/workspaces
//
// Top of the multi-tenant hierarchy. A Workspace owns one or more
// Teams; each Team owns zero or more Projects. The schema (see
// prisma/schema.prisma) is additive — every existing project pre-dates
// the workspace / team split, and a back-fill migration would silently
// reassign the whole install to a single team. We deliberately leave
// those projects with teamId = NULL ("legacy / unscoped") and let the
// GET /api/projects filter show them to callers with no team
// memberships until every user has been invited to a team.
//
// Auth: every handler is gated by requireDashboardSession (the same
// gate the other dashboard routes use). No session check at this
// layer — workspace creation is open to any dashboard caller. A
// follow-up can add an "operator-only" gate if we want to restrict
// org creation to admins.
//
// Contract:
//   GET  /api/workspaces         — every workspace (with team counts)
//   POST /api/workspaces         — create a workspace, name required
//   PATCH /api/workspaces/[id]   — rename a workspace
//   DELETE /api/workspaces/[id]  — remove a workspace (Cascades to
//                                   teams / team members)
//
// The list response is sorted by createdAt desc so the dashboard
// always sees the freshest workspace first. The create response
// returns the full row so the client can immediately navigate to
// /workspaces/[id] without a follow-up GET.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { validateWorkspaceName } from '@/lib/validation';

export async function GET(req: Request) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      // Project counts aren't included here — the dashboard's
      // <WorkspacesList> only needs the team count, and counting
      // projects would require an aggregation that's easy to skip.
      // The per-workspace detail page (/workspaces/[id]) renders
      // the full team list with project counts on demand.
      _count: {
        select: { teams: true },
      },
    },
  });

  return NextResponse.json(
    workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      teamCount: w._count.teams,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }))
  );
}

export async function POST(req: Request) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const { name } = body as { name?: unknown };
    const nameRes = validateWorkspaceName(name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });

    const workspace = await prisma.workspace.create({
      data: { name: nameRes.value },
    });
    audit({ actor: workspace.id, action: 'workspace.create', target: workspace.id, metadata: { name: workspace.name } });
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    console.error('Workspace create error:', error);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
}
