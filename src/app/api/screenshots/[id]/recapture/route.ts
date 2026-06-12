import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { spawn } from 'child_process';
import { consume } from '@/lib/rate-limit';

const RECAPTURE_SCRIPT = process.env.RECAPTURE_SCRIPT || '/root/markup-clone/scripts/recapture.sh';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  const { id } = await params;

  // Rate limit: split into two buckets so a busy operator who clicks
  // Recapture on many screenshots doesn't share a single bucket and end up
  // throttling themselves on every other screenshot. The original key was
  // `${origin}:${id}` which conflated the two — 5 captures on one screenshot
  // would block recapture on every other screenshot for the same origin.
  const origin = req.headers.get('origin') ?? 'unknown';
  // Per-screenshot: prevent one stuck screenshot from monopolising Chromium.
  const perShot = consume(`recapture:shot:${id}`, { maxTokens: 3, refillRate: 0.1 });
  if (!perShot.ok) {
    return NextResponse.json(
      { error: 'Too many recaptures on this screenshot', retryAfterSec: perShot.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(perShot.retryAfterSec) } }
    );
  }
  // Per-origin: prevent one operator from running away (run-a-Cromium-tab DoS).
  const perOrigin = consume(`recapture:origin:${origin}`, { maxTokens: 10, refillRate: 0.5 });
  if (!perOrigin.ok) {
    return NextResponse.json(
      { error: 'Too many recaptures from this dashboard session', retryAfterSec: perOrigin.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(perOrigin.retryAfterSec) } }
    );
  }

  try {

    // Verify the screenshot exists
    const ss = await prisma.screenshot.findUnique({ where: { id } });
    if (!ss) {
      return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
    }

    // Fire-and-forget the recapture (it's slow — 5s+ for Chromium to spin up)
    // Caller can poll GET /api/projects to see when the new PNG is served.
    // The script lives at /opt/app-scripts/recapture.sh on the container, which
    // is a bind mount of the host's /root/markup-clone/scripts/ (set up by
    // deploy.sh). bash is in the image (added to Dockerfile for this).
    const child = spawn('bash', ['/opt/app-scripts/recapture.sh', id], {
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
