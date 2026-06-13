import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { spawn } from 'child_process';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

// RECAPTURE_SCRIPT lets the operator override the script path at
// runtime (e.g. to mount scripts at a different location in a
// non-standard deploy). Default is the bind-mount path that deploy.sh
// creates at /root/markup-clone/scripts/ -> /opt/app-scripts:ro.
const RECAPTURE_SCRIPT = process.env.RECAPTURE_SCRIPT || '/opt/app-scripts/recapture.sh';

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
  // Note: rate-limit state is in-process (see src/lib/rate-limit.ts).
  // Fine for the current single-instance deploy; will not share buckets
  // across instances if we ever scale horizontally.
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

    // Fire-and-forget the recapture (it's slow — 5s+ for Chromium to spin up).
    // Caller can poll GET /api/projects to see when the new PNG is served.
    //
    // We capture stderr (capped at 4 KB) and attach exit/error listeners so
    // that a missing chromium binary, a script syntax error, or a non-zero
    // exit code produces a real error message in the container logs and an
    // audit entry. Without this, the HTTP response is 200 {"status":
    // "started"} and the operator has no idea why the screenshot never
    // updates. Previously the child had no listeners and stdio was
    // 'ignore', so chromium-missing was completely silent.
    const child = spawn('bash', [RECAPTURE_SCRIPT, id], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.unref();

    let stderrTail = '';
    const STDERR_CAP = 4096;
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrTail.length < STDERR_CAP) {
          stderrTail += chunk.toString('utf8').slice(0, STDERR_CAP - stderrTail.length);
        }
      });
    }
    child.on('error', (err) => {
      console.error(`[recapture] spawn error for ${id}:`, err);
      audit({
        actor: 'system',
        action: 'screenshot.recapture',
        target: id,
        metadata: { status: 'spawn_error', message: String(err) },
      });
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        audit({
          actor: 'system',
          action: 'screenshot.recapture',
          target: id,
          metadata: { status: 'ok', pid: child.pid },
        });
        return;
      }
      const message = stderrTail.trim() || `exit ${code}${signal ? ` (signal ${signal})` : ''}`;
      console.error(`[recapture] ${id} failed: ${message}`);
      audit({
        actor: 'system',
        action: 'screenshot.recapture',
        target: id,
        metadata: { status: 'failed', code, signal, stderr: message },
      });
    });

    return NextResponse.json({
      success: true,
      data: { screenshotId: id, pid: child.pid, status: 'started' }
    });
  } catch (error) {
    console.error('Recapture error:', error);
    return NextResponse.json({ error: 'Failed to start recapture' }, { status: 500 });
  }
}
