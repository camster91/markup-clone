import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireDashboardOrigin } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { validateScreenshotId } from '@/lib/validation';
import { spawn } from 'child_process';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { assertProjectAdmin } from '@/lib/teams';

// RECAPTURE_SCRIPT lets the operator override the script path at
// runtime (e.g. to mount scripts at a different location in a
// non-standard deploy). Default is the bind-mount path that deploy.sh
// creates at /root/markup-clone/scripts/ -> /opt/app-scripts:ro.
const RECAPTURE_SCRIPT = process.env.RECAPTURE_SCRIPT || '/opt/app-scripts/recapture.sh';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Same gate as requireDashboardAuth (Origin check + session), done
  // inline so the Session row is looked up once and the caller id is
  // reused for the per-user rate limit below.
  const originErr = requireDashboardOrigin(req);
  if (originErr) return originErr;
  const caller = await requireAuth();
  if (!caller) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  const { id } = await params;
  const idRes = validateScreenshotId(id);
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  // Rate limit (per screenshot): prevent one stuck screenshot
  // from monopolising Chromium. Keyed `<endpoint>:origin:<host>:<id>` like
  // every other dashboard bucket. Every dashboard user shares the same
  // Origin, so an origin-only key would be one global bucket for the whole
  // install — a single user could lock everyone else out of recapture.
  // Note: rate-limit state is in-process (see src/lib/rate-limit.ts).
  // Fine for the current single-instance deploy; will not share buckets
  // across instances if we ever scale horizontally.
  const origin = req.headers.get('origin') ?? 'unknown';

  // Rate limit, per user, BEFORE the lookup: a caller rotating through
  // valid-but-unknown screenshot ids would otherwise get a fresh
  // per-screenshot bucket (and a DB lookup) on every request. This also
  // stops one account from fanning recaptures out across many
  // screenshots (run-a-Chromium-tab DoS).
  const perUser = consume(`recapture-user:origin:${origin}:${caller.id}`, { maxTokens: 10, refillRate: 0.5 });
  if (!perUser.ok) {
    return NextResponse.json(
      { error: 'Too many recaptures from this dashboard session', retryAfterSec: perUser.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(perUser.retryAfterSec) } }
    );
  }

  const perShot = consume(`recapture:origin:${origin}:${id}`, { maxTokens: 3, refillRate: 0.1 });
  if (!perShot.ok) {
    return NextResponse.json(
      { error: 'Too many recaptures on this screenshot', retryAfterSec: perShot.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(perShot.retryAfterSec) } }
    );
  }

  try {
    // Resolve screenshot -> page -> project and gate on project
    // administration. Recapture replaces the canonical image every
    // reviewer sees and spends a headless-Chromium run, so it is held to
    // the same bar as the other heavy project mutations (image/PDF
    // upload, share links, integrations): owner/contributor or operator.
    const ss = await prisma.screenshot.findUnique({
      where: { id },
      select: { id: true, page: { select: { projectId: true } } },
    });
    const projectId = ss?.page?.projectId;
    if (!ss || !projectId) {
      return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
    }
    const access = await assertProjectAdmin(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    audit({
      actor: access.caller.email,
      action: 'screenshot.recapture',
      target: id,
      metadata: { status: 'requested', projectId },
    });

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
        //
        // ScreenshotVersion side effect: the script wrote the new
        // PNG to a fresh UUID-based path and updated the Screenshot
        // row's storageKey + width + height + capturedAt. We insert
        // a matching ScreenshotVersion row that mirrors those
        // values. The version row is the immutable history entry;
        // the Screenshot stays the "latest pointer". We do this as
        // a best-effort write — a version insert failure is logged
        // but does NOT fail the recapture (the file is on disk and
        // the Screenshot is up to date; the gap is observable in
        // the history endpoint and recoverable by a re-recapture).
        prisma.screenshot
          .findUnique({
            where: { id },
            select: {
              width: true,
              height: true,
              capturedAt: true,
              storageKey: true,
              page: { select: { projectId: true } },
            },
          })
          .then((ss) => {
            if (!ss || !ss.page) return;
            // Insert the version row. The Screenshot's storageKey
            // is the new file's name (the script generated the
            // UUID and updated the Screenshot in one statement),
            // so the version's storageKey is the same value.
            prisma.screenshotVersion
              .create({
                data: {
                  screenshotId: id,
                  capturedAt: ss.capturedAt,
                  width: ss.width,
                  height: ss.height,
                  storageKey: ss.storageKey,
                  createdBy: 'system',
                },
              })
              .catch((verr) => {
                // The recapture already succeeded. A failed
                // version insert doesn't fail the response — the
                // file is on disk and the Screenshot is up to
                // date. We log so the gap is visible in
                // container logs and an operator can backfill
                // by re-recapturing.
                console.error('[recapture] version insert failed for', id, verr);
              })
              .finally(() => {
                emit({
                  type: 'recapture-complete',
                  projectId: ss.page!.projectId,
                  payload: {
                    screenshotId: id,
                    width: ss.width,
                    height: ss.height,
                    capturedAt: ss.capturedAt.toISOString(),
                  },
                });
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
