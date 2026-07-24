// /api/projects/[id]
//
// Per-project mutations: DELETE (cascade + on-disk screenshot files)
// and PATCH (rename / regenerate apiKey).
//
// Team-scope gate: the request body says "this project id"; the
// route must verify the caller's session user is in the project's
// team before touching it. Without the gate, a dashboard caller who
// guesses a UUID could rotate the API key on a project they don't
// own, or delete it. The check is a single membership lookup that
// runs after the project exists check (so 404s on missing projects
// don't leak "the project exists but you can't see it" — both look
// the same to a probing caller).
//
// 403 semantics: when the project exists but the caller is not in
// the project's team, return 403 with a "Not a member of this
// project's team" error. A project with teamId = NULL ("legacy /
// unscoped") is open to every dashboard caller for the
// transitional single-project dashboard — that's the only way the
// pre-workspace install keeps working.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { unlink } from 'fs/promises';
import { validateProjectName } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/project-access';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    const access = await assertProjectAccessible(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Collect all screenshot storageKeys for this project before deleting.
    // CASCADE: Page → Screenshot → Pin → Comment are handled by the DB,
    // but screenshot PNG files on disk are NOT in the DB cascade.
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true, domain: true },
    });
    const screenshots = await prisma.screenshot.findMany({
      where: { page: { projectId: id } },
      select: { storageKey: true },
    });

    let filesRemoved = 0;
    for (const ss of screenshots) {
      try {
        await unlink(`${SCREENSHOTS_DIR}/${ss.storageKey}`);
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

// PATCH /api/projects/[id] — rename and/or regenerate apiKey.
// NOTE: Only the dashboard settings UI calls this. If regenerateKey is true,
// widgets using the old key will start receiving 401s — this is the intended
// behaviour so operators can rotate a compromised key.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    const access = await assertProjectAccessible(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await req.json();
    const { name, regenerateKey } = body as { name?: string; regenerateKey?: boolean };

    // Validate inputs. Reject empty name, non-string, or ridiculously long.
    // Without these, prisma throws an opaque error that the user can't act on.
    if (name !== undefined) {
      const nameRes = validateProjectName(name);
      if (!nameRes.ok) {
        return NextResponse.json({ error: nameRes.error }, { status: 400 });
      }
    }
    if (regenerateKey !== undefined && typeof regenerateKey !== 'boolean') {
      return NextResponse.json({ error: 'regenerateKey must be a boolean' }, { status: 400 });
    }

    const data: { name?: string; apiKey?: string } = {};
    if (name !== undefined) data.name = name;
    if (regenerateKey === true) data.apiKey = generateApiKey();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'name or regenerateKey required' }, { status: 400 });
    }

    // Redact sensitive fields before writing to the audit log. apiKey is the
    // canonical example: if we store the new plaintext key in AuditLog, the
    // /api/audit endpoint (and any future log-search UI) leaks it to anyone
    // with dashboard access. Record a "was rotated" marker instead.
    const changes: Record<string, unknown> = {};
    if (name !== undefined) changes.name = name;
    if (regenerateKey === true) changes.apiKey = 'rotated';

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
