import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { unlink } from 'fs/promises';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
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
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

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
