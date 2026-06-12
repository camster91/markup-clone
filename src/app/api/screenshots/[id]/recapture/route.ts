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

  // Rate limit by Origin header: 5 tokens, 1 per 10 seconds
  const origin = req.headers.get('origin') ?? 'unknown';
  const rateLimitKey = `${origin}:${id}`;
  const rateLimit = consume(rateLimitKey, { maxTokens: 5, refillRate: 0.1 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterSec: rateLimit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
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
