// /api/projects/[id]
//
// Per-project mutations: DELETE (cascade + on-disk screenshot files)
// and PATCH (rename / regenerate apiKey).
//
// Auth: requireDashboardAuth (Origin + session) + CSRF on writes.
// Team-scope: assertProjectAccessible (shared with other project-
// scoped routes via lib/teams.ts).

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { unlink } from 'fs/promises';
import path from 'path';
import { validateProjectName, validateProjectId } from '@/lib/validation';
import { assertProjectAccessible, assertProjectAdmin } from '@/lib/teams';
import { requireCsrfToken } from '@/lib/csrf';
import { projectDetailInclude, serializeProjectDetail } from '@/lib/project-detail-dto';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || '/data/attachments';

// Columns PATCH echoes back. Deliberately excludes the share credentials
// (shareToken, shareExpiresAt, sharePasswordHash): the password hash must
// never leave the server, and the share token has its own admin route.
// apiKey stays because the "Regenerate API key" flow shows the new key
// once from this response.
const projectPatchSelect = {
  id: true,
  name: true,
  domain: true,
  apiKey: true,
  teamId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

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
    // Collect every file the project owns before the rows cascade away:
    // screenshots, their recapture history, PDF sources, and comment
    // attachments (older attachment rows may only link via the comment).
    const [screenshots, versions, reviewAssets, attachments] = await Promise.all([
      prisma.screenshot.findMany({
        where: { page: { projectId: id } },
        select: { storageKey: true },
      }),
      prisma.screenshotVersion.findMany({
        where: { screenshot: { page: { projectId: id } } },
        select: { storageKey: true },
      }),
      prisma.reviewAsset.findMany({
        where: { projectId: id },
        select: { storageKey: true },
      }),
      prisma.attachment.findMany({
        where: {
          OR: [
            { projectId: id },
            { comment: { pin: { screenshot: { page: { projectId: id } } } } },
          ],
        },
        select: { storageKey: true },
      }),
    ]);
    const files = new Set<string>([
      ...[...screenshots, ...versions, ...reviewAssets].map((f) => path.join(SCREENSHOTS_DIR, f.storageKey)),
      ...attachments.map((f) => path.join(ATTACHMENTS_DIR, f.storageKey)),
    ]);

    // Delete the rows first. If this fails, every file is still in place
    // and the project keeps working; unlinking first would leave rows
    // pointing at missing images.
    await prisma.project.delete({ where: { id } });

    let filesRemoved = 0;
    let filesFailed = 0;
    for (const file of files) {
      try {
        await unlink(file);
        filesRemoved++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        filesFailed++;
        console.error('Project delete: could not remove file', file, err);
      }
    }
    audit({
      actor: access.caller.email,
      action: 'project.delete',
      target: id,
      metadata: { name: project?.name, domain: project?.domain, teamId: access.teamId },
    });

    return NextResponse.json({ deleted: true, filesRemoved, filesFailed, projects: 1 });
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

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 });
    }
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

    const project = await prisma.project.update({ where: { id }, data, select: projectPatchSelect });
    audit({
      actor: access.caller.email,
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
