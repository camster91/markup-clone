import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin, generateApiKey } from '@/lib/auth';
import { unlink } from 'fs/promises';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    // Collect all screenshot storageKeys for this project before deleting.
    // CASCADE: Page → Screenshot → Pin → Comment are handled by the DB,
    // but screenshot PNG files on disk are NOT in the DB cascade.
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
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const body = await req.json();
    const { name, regenerateKey } = body as { name?: string; regenerateKey?: boolean };

    const data: { name?: string; apiKey?: string } = {};
    if (name !== undefined) data.name = name;
    if (regenerateKey === true) data.apiKey = generateApiKey();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'name or regenerateKey required' }, { status: 400 });
    }

    const project = await prisma.project.update({ where: { id }, data });
    return NextResponse.json(project);
  } catch (error) {
    console.error('Project update error:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}
