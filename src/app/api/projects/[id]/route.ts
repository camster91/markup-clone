// /api/projects/[id]
//
// Per-project mutations: DELETE (cascade + on-disk screenshot files)
// and PATCH (rename / regenerate apiKey).
//
// Auth: requireDashboardAuth (Origin + session) + CSRF on writes.
// Team-scope: assertProjectAccessible (shared with other project-
// scoped routes via lib/teams.ts).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { unlink } from 'fs/promises';
import { validateProjectName, validateProjectId } from '@/lib/validation';
import { assertProjectAccessible, assertProjectAdmin } from '@/lib/teams';
import { requireCsrfToken } from '@/lib/csrf';
import { projectDetailInclude, serializeProjectDetail } from '@/lib/project-detail-dto';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAccessible(idRes.value);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const project = await prisma.project.findUnique({
      where: { id: idRes.value },
      include: projectDetailInclude,
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const canAdmin = access.membershipRole === 'owner'
      || access.membershipRole === 'contributor'
      || access.membershipRole === 'operator';
    return NextResponse.json({
      ...serializeProjectDetail(project, canAdmin),
      accessRole: access.membershipRole,
    });
  } catch (error) {
    console.error('Project detail error:', error);
    return NextResponse.json({ error: 'Failed to load project' }, { status: 500 });
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

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true, domain: true },
    });
    const screenshots = await prisma.screenshot.findMany({
      where: { page: { projectId: id } },
      select: { storageKey: true },
    });
    const reviewAssets = await prisma.reviewAsset.findMany({
      where: { projectId: id },
      select: { storageKey: true },
    });

    let filesRemoved = 0;
    for (const file of [...screenshots, ...reviewAssets]) {
      try {
        await unlink(`${SCREENSHOTS_DIR}/${file.storageKey}`);
        filesRemoved++;
      } catch {
        // File may already be missing; continue
      }
    }

    await prisma.project.delete({ where: { id } });
    audit({
      actor: id,
      action: 'project.delete',
      target: id,
      metadata: { name: project?.name, domain: project?.domain, teamId: access.teamId },
    });

    return NextResponse.json({ deleted: true, filesRemoved, projects: 1 });
  } catch (error) {
    console.error('Project delete error:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await req.json();
    const { name, regenerateKey, archived } = body as {
      name?: string;
      regenerateKey?: boolean;
      archived?: boolean;
    };

    if (name !== undefined) {
      const nameRes = validateProjectName(name);
      if (!nameRes.ok) {
        return NextResponse.json({ error: nameRes.error }, { status: 400 });
      }
    }
    if (regenerateKey !== undefined && typeof regenerateKey !== 'boolean') {
      return NextResponse.json({ error: 'regenerateKey must be a boolean' }, { status: 400 });
    }
    if (archived !== undefined && typeof archived !== 'boolean') {
      return NextResponse.json({ error: 'archived must be a boolean' }, { status: 400 });
    }

    let archivedAt: Date | null | undefined;
    if (archived === true) {
      const current = await prisma.project.findUnique({
        where: { id },
        select: { archivedAt: true },
      });
      archivedAt = current?.archivedAt ?? new Date();
    } else if (archived === false) {
      archivedAt = null;
    }

    const data: { name?: string; apiKey?: string; archivedAt?: Date | null } = {};
    if (name !== undefined) data.name = name;
    if (regenerateKey === true) data.apiKey = generateApiKey();
    if (archived !== undefined) data.archivedAt = archivedAt;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'name, regenerateKey, or archived required' }, { status: 400 });
    }

    const changes: Record<string, unknown> = {};
    if (name !== undefined) changes.name = name;
    if (regenerateKey === true) changes.apiKey = 'rotated';
    if (archived !== undefined) changes.archived = archived;

    const project = await prisma.project.update({ where: { id }, data });
    audit({
      actor: id,
      action: 'project.update',
      target: id,
      metadata: { changes, teamId: access.teamId },
    });
    return NextResponse.json(project);
  } catch (error) {
    console.error('Project update error:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}
