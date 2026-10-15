// GET /api/screenshots/[id]/status
//
// Lightweight status endpoint used by ScreenshotView to poll for the
// width/height/capturedAt of a single screenshot during a recapture. Replaces
// the previous full-tree /api/projects poll, which pulled the entire
// project → page → screenshot → pin → comment graph on every 1s tick.
//
// Response shape (200): { width, height, capturedAt }
//
// Optional ?since=<ISO timestamp>: if the screenshot's capturedAt is older
// than (or equal to) the `since` value, return 304 Not Modified with no
// body. This is the "nothing has changed" signal the recapture polling loop
// uses to short-circuit the render update on stale state.
//
// When a screenshot is just recaptured, capturedAt is bumped, so a
// ?since=<old-timestamp> check returns 200 with the new dims — the 304
// only fires when nothing has changed.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireDashboardOrigin } from '@/lib/auth';
import { validateScreenshotId } from '@/lib/validation';
import { consume } from '@/lib/rate-limit';
import { assertProjectAccessible } from '@/lib/teams';

export async function GET(
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

  const { id } = await params;
  const idRes = validateScreenshotId(id);
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  // Rate limit AFTER auth + UUID validation, BEFORE the DB query.
  // 120 tokens / 2.0 per second: ~60s sustained with a 2× safety margin
  // over the legitimate 30s poll × 2 ScreenshotView instances = 4 polls/min
  // steady state. Tight enough to catch a runaway client; loose enough to
  // never throttle the normal recapture polling loop. Note: rate-limit
  // state is in-process (see src/lib/rate-limit.ts) — fine for the current
  // single-instance deploy.
  //
  // Keyed per screenshot (`<endpoint>:origin:<host>:<id>`): every dashboard
  // user shares one Origin, so an origin-only key was a single global
  // bucket — one runaway tab could 429 every other user's polling.
  const origin = req.headers.get('origin') ?? 'unknown';
  // Caller-wide cap first: a client rotating through unknown screenshot
  // ids would otherwise get a fresh per-screenshot bucket (and a DB
  // lookup) every time. Sized above the per-screenshot budget so one
  // busy screenshot never throttles the caller's other tabs.
  const callerCheck = consume(`status-user:origin:${origin}:${caller.id}`, { maxTokens: 600, refillRate: 10 });
  if (!callerCheck.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(callerCheck.retryAfterSec) } });
  }
  const rateCheck = consume(`status:origin:${origin}:${id}`, { maxTokens: 120, refillRate: 2.0 });
  if (!rateCheck.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
  }

  // Resolve screenshot -> page -> project so the read is tenant-scoped:
  // a caller outside the owning project's team gets 403, not the dims.
  const ss = await prisma.screenshot.findUnique({
    where: { id },
    select: { width: true, height: true, capturedAt: true, page: { select: { projectId: true } } },
  });
  const projectId = ss?.page?.projectId;
  if (!ss || !projectId) {
    return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
  }
  const access = await assertProjectAccessible(projectId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Optional ?since=<ISO timestamp> — short-circuit with 304 when nothing
  // has changed. We compare numerically on epoch ms so we don't have to
  // worry about clock skew between server serialisation and client parse.
  const sinceRaw = new URL(req.url).searchParams.get('since');
  if (sinceRaw) {
    const sinceMs = Date.parse(sinceRaw);
    if (!Number.isNaN(sinceMs) && ss.capturedAt.getTime() <= sinceMs) {
      return new NextResponse(null, { status: 304 });
    }
  }

  return NextResponse.json({
    width: ss.width,
    height: ss.height,
    capturedAt: ss.capturedAt.toISOString(),
  });
}
