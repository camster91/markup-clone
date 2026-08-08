// /api/workspaces/[id]
//
// Per-workspace operations: rename (PATCH) and delete (DELETE).
//
// Cascade: deleting a workspace removes every Team in it (Cascade on
// the FK). Each Team in turn Cascades to its TeamMember rows, and
// Project.teamId is `Restrict` — so the FK will refuse to delete a
// team that still owns projects. The pre-check below counts the
// projects across the workspace's teams and returns 409 with a clear
// "move or delete projects first" message before Prisma's opaque
// P2003 conflict surfaces. This is the same belt-and-suspenders
// pattern used in /api/projects/[id]/integrations and elsewhere.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import {
  validateBrandAccentColor,
  validateBrandLogoUrl,
  validateBrandName,
  validateReviewerWelcome,
  validateWorkspaceName,
  validateUuidParam,
} from '@/lib/validation';
import { assertOperator } from '@/lib/teams';

export async function PATCH(
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

    const body = await req.json() as Record<string, unknown>;
    const data: {
      name?: string;
      brandName?: string | null;
      logoUrl?: string | null;
      accentColor?: string | null;
      reviewerWelcome?: string | null;
    } = {};
    if (Object.hasOwn(body, 'name')) {
      const result = validateWorkspaceName(body.name);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      data.name = result.value;
    }
    const brandingFields = [
      ['brandName', validateBrandName],
      ['logoUrl', validateBrandLogoUrl],
      ['accentColor', validateBrandAccentColor],
      ['reviewerWelcome', validateReviewerWelcome],
    ] as const;
    for (const [field, validate] of brandingFields) {
      if (!Object.hasOwn(body, field)) continue;
      const result = validate(body[field]);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      data[field] = result.value;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No supported workspace fields provided' }, { status: 400 });
    }

    const existing = await prisma.workspace.findUnique({ where: { id: idRes.value }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const workspace = await prisma.workspace.update({
      where: { id: idRes.value },
      data,
    });
    audit({
      actor: access.caller.id,
      action: 'workspace.update',
      target: workspace.id,
      metadata: {
        changedFields: Object.keys(data),
        name: workspace.name,
      },
    });
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Workspace update error:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
}

export async function DELETE(
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

    const existing = await prisma.workspace.findUnique({
      where: { id: idRes.value },
      include: {
        teams: {
          select: {
            id: true,
            _count: { select: { projects: true } },
          },
        },
      },
    });
    if (!existing) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Pre-check: refuse to delete a workspace that owns projects. The
    // Prisma FK is `Restrict` on Project.teamId, so this would fail
    // anyway with a P2003 — but surfacing the human-readable count
    // here is a much better experience than a generic 500. The
    // count is cheap (single aggregate over the join keys).
    const projectCount = existing.teams.reduce((acc, t) => acc + t._count.projects, 0);
    if (projectCount > 0) {
      return NextResponse.json(
        { error: `Workspace has ${projectCount} active project(s); move or delete them first` },
        { status: 409 }
      );
    }

    await prisma.workspace.delete({ where: { id: idRes.value } });
    audit({ actor: idRes.value, action: 'workspace.delete', target: idRes.value, metadata: { name: existing.name } });
    return NextResponse.json({ deleted: true, id: idRes.value });
  } catch (error) {
    console.error('Workspace delete error:', error);
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
