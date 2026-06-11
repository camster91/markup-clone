import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { spawn } from 'child_process';

const RECAPTURE_SCRIPT = process.env.RECAPTURE_SCRIPT || '/root/markup-clone/scripts/recapture.sh';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    // Verify the screenshot exists
    const ss = await prisma.screenshot.findUnique({ where: { id } });
    if (!ss) {
      return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
    }

    // Fire-and-forget the recapture (it's slow — 5s+ for Chromium to spin up)
    // Caller can poll GET /api/projects to see when the new PNG is served.
    const child = spawn('bash', [RECAPTURE_SCRIPT, id], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({
      success: true,
      data: { screenshotId: id, pid: child.pid, status: 'started' }
    });
  } catch (error) {
    console.error('Recapture error:', error);
    return NextResponse.json({ error: 'Failed to start recapture' }, { status: 500 });
  }
}
