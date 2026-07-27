import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { unlink } from 'fs/promises';
import { validatePinId } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/teams';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

async function resolvePinProjectId(pinId: string): Promise<string | null> {
  const pin = await prisma.pin.findUnique({
    where: { id: pinId },
    select: {
      screenshot: { select: { page: { select: { projectId: true } } } },
    },
  });
  return pin?.screenshot?.page?.projectId ?? null;
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
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    const projectId = await resolvePinProjectId(id);
    if (!projectId) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
    }
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { status } = await req.json();
    if (status !== 'OPEN' && status !== 'RESOLVED') {
      return NextResponse.json({ error: 'status must be OPEN or RESOLVED' }, { status: 400 });
    }
    const pin = await prisma.pin.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ success: true, data: pin });
  } catch (error) {
    console.error('Pin update error:', error);
    return NextResponse.json({ error: 'Failed to update pin' }, { status: 500 });
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
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    const projectId = await resolvePinProjectId(id);
    if (!projectId) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
    }
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Find the pin and its screenshot
    const pin = await prisma.pin.findUnique({
      where: { id },
      select: { screenshotId: true },
    });
    if (!pin) return NextResponse.json({ error: 'Pin not found' }, { status: 404 });

    const screenshot = await prisma.screenshot.findUnique({
      where: { id: pin.screenshotId },
      select: { storageKey: true },
    });

    // Delete the screenshot file from disk
    if (screenshot) {
      try {
        await unlink(`${SCREENSHOTS_DIR}/${screenshot.storageKey}`);
      } catch {
        // File may already be missing
      }
      // Delete the screenshot row (cascade removes comments)
      await prisma.screenshot.delete({ where: { id: pin.screenshotId } });
    }

    // Delete the pin
    await prisma.pin.delete({ where: { id } });
    audit({ actor: pin.screenshotId, action: 'pin.delete', target: id });

    return NextResponse.json({
      deleted: true,
      pin: 1,
      screenshotFile: screenshot?.storageKey ?? null,
    });
  } catch (error) {
    console.error('Pin delete error:', error);
    return NextResponse.json({ error: 'Failed to delete pin' }, { status: 500 });
  }
}
