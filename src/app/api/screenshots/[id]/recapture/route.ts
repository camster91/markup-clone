import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { validateScreenshotId } from '@/lib/validation';
import { spawn } from 'child_process';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';

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
  const idRes = validateScreenshotId(id);
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

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
        // Live update: broadcast a recapture-complete event so any
        // dashboard open on this project can update its
        // ScreenshotView image without polling for 90s. We emit ONLY
        // on a successful exit (code 0) — the script's final UPDATE
        // statement ran successfully, so the Screenshot row's
        // width/height are already up-to-date in the DB and the new
        // PNG is on disk. emit() is synchronous + best-effort; a
        // dead SSE client can't fail the recapture.
        //
        // We re-read the screenshot row to get the actual updated
        // width/height/capturedAt — the route already has a Prisma
        // connection open, and the dashboard's useRecaptureStatus
        // hook compares against its initial dims to decide whether
        // the image actually changed. If the recapture produced the
        // exact same dims, the SSE update is a no-op visually but
        // still useful: it tells the hook it can stop polling.
        prisma.screenshot
          .findUnique({
            where: { id },
            select: {
              width: true,
              height: true,
              capturedAt: true,
              page: { select: { projectId: true } },
            },
          })
          .then((ss) => {
            if (!ss || !ss.page) return;
            emit({
              type: 'recapture-complete',
              projectId: ss.page.projectId,
              payload: {
                screenshotId: id,
                width: ss.width,
                height: ss.height,
                capturedAt: ss.capturedAt.toISOString(),
              },
            });
          })
          .catch((err) => {
            // The recapture already succeeded (code === 0). A
            // failed follow-up read shouldn't be logged at error
            // level — it just means the SSE live-update path is
            // unavailable. The polling fallback still works.
            console.error('[recapture] follow-up read failed for SSE emit:', err);
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
