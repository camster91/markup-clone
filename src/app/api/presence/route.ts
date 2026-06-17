// Multi-user real-time collaboration: presence heartbeats.
//
// Polling version — F2 will swap this for SSE.
//
// POST  /api/presence
//   body: { projectId, userId, screenshotId?, cursorX?, cursorY? }
//   - upsert by (userId, projectId); bumps lastSeenAt = now()
//   - returns the row back so the caller can confirm
//   - auth: dashboard origin (same as the rest of /api/*)
//
// GET   /api/presence?projectId=X&since=ISO
//   - returns rows for that project whose lastSeenAt > since
//   - `since` is an ISO date string. If omitted or unparseable, the
//     route uses the 60s TTL as the floor (matches the dashboard's
//     "online" definition — anything older is offline).
//   - auth: dashboard origin
//
// Why no auth on `userId`: F10 will add a real User model + session and
// replace the client-generated UUID with a server-issued id. For now the
// client just reads from localStorage; anyone with the dashboard origin
// can pose as anyone. That's fine because the dashboard origin is
// trusted (same allow-list as the rest of the API). The presence rows
// are advisory — they show up as colored dots in the dashboard — so the
// worst case is someone spams the list with fake cursors, which the
// 5s heartbeat already bounds to ~12 rows/min/IP.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { validateScreenshotId, validatePercent } from '@/lib/validation';

// Presence TTL. Anything older than this is "offline" and the GET route
// excludes it. Bumped by the heartbeat on every POST. The dashboard
// polls every 5s, so 60s = up to ~12 missed heartbeats before a user
// drops off the list — long enough to survive a tab-throttle, short
// enough that closing the tab takes effect within a minute.
const PRESENCE_TTL_MS = 60_000;

// UUID v4 shape — used for both projectId and userId. Slightly looser
// than Prisma's UUID column (which is also a 36-char dash-separated
// hex) but identical in practice. The regex matches both v4 and any
// future variant — we only care about the shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, name: string): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return `${name} must be a UUID`;
  }
  return null;
}

export async function POST(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  let body: {
    projectId?: unknown;
    userId?: unknown;
    screenshotId?: unknown;
    cursorX?: unknown;
    cursorY?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // projectId: required, must be a UUID (Prisma's @default(uuid()))
  const projectIdErr = requireUuid(body.projectId, 'projectId');
  if (projectIdErr) return NextResponse.json({ error: projectIdErr }, { status: 400 });
  const projectId = body.projectId as string;

  // userId: required, must be a UUID. The client generates a v4 on
  // first load and stores it in localStorage. A bad userId usually
  // means a bug (or someone hand-rolling fetch calls in devtools) —
  // reject 400 so we don't poison the index with garbage.
  const userIdErr = requireUuid(body.userId, 'userId');
  if (userIdErr) return NextResponse.json({ error: userIdErr }, { status: 400 });
  const userId = body.userId as string;

  // screenshotId: optional. If present, must be a UUID. The route
  // intentionally does NOT verify the screenshot belongs to the
  // project — the upsert keys are (userId, projectId) and a stale
  // screenshotId just means "the cursor was last seen on a now-gone
  // screenshot", which the dashboard already handles by clearing
  // the cursor dot.
  let screenshotId: string | null = null;
  if (body.screenshotId !== undefined && body.screenshotId !== null) {
    if (typeof body.screenshotId !== 'string') {
      return NextResponse.json({ error: 'screenshotId must be a string' }, { status: 400 });
    }
    const ssIdRes = validateScreenshotId(body.screenshotId);
    if (!ssIdRes.ok) return NextResponse.json({ error: ssIdRes.error }, { status: 400 });
    screenshotId = ssIdRes.value;
  }

  // cursorX/cursorY: optional. 0-100 percentage of the screenshot
  // bounds. We accept null (clears the cursor — the user moved the
  // mouse off the image) and a finite number.
  let cursorX: number | null = null;
  let cursorY: number | null = null;
  if (body.cursorX !== undefined && body.cursorX !== null) {
    const xRes = validatePercent(body.cursorX, 'cursorX');
    if (!xRes.ok) return NextResponse.json({ error: xRes.error }, { status: 400 });
    cursorX = xRes.value;
  }
  if (body.cursorY !== undefined && body.cursorY !== null) {
    const yRes = validatePercent(body.cursorY, 'cursorY');
    if (!yRes.ok) return NextResponse.json({ error: yRes.error }, { status: 400 });
    cursorY = yRes.value;
  }

  // Upsert: if (userId, projectId) already exists, bump lastSeenAt +
  // overwrite the cursor; otherwise create a new row. The unique
  // index on (userId, projectId) makes this atomic.
  const row = await prisma.presence.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: {
      userId,
      projectId,
      screenshotId,
      lastSeenAt: new Date(),
      cursorX,
      cursorY,
    },
    update: {
      lastSeenAt: new Date(),
      screenshotId,
      cursorX,
      cursorY,
    },
  });

  return NextResponse.json({ presence: row }, { status: 200 });
}

export async function GET(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const projectIdParam = url.searchParams.get('projectId');
  const sinceParam = url.searchParams.get('since');

  // projectId: required. The whole point of this endpoint is
  // "who's looking at THIS project".
  const projectIdErr = requireUuid(projectIdParam, 'projectId');
  if (projectIdErr) return NextResponse.json({ error: projectIdErr }, { status: 400 });
  const projectId = projectIdParam as string;

  // The cursor: rows whose lastSeenAt is strictly after this. If the
  // client passed nothing (or something unparseable), use the 60s
  // TTL as the implicit floor — this matches the dashboard's
  // "online" definition and means a brand-new tab sees the right
  // list without having to remember to pass a cursor.
  let since: Date;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (Number.isNaN(parsed.getTime())) {
      since = new Date(Date.now() - PRESENCE_TTL_MS);
    } else {
      // Clamp to the TTL: a stale cursor (e.g. the dashboard was
      // closed for 10 minutes) must not bring back rows older
      // than the "online" window.
      const ttlFloor = new Date(Date.now() - PRESENCE_TTL_MS);
      since = parsed > ttlFloor ? parsed : ttlFloor;
    }
  } else {
    since = new Date(Date.now() - PRESENCE_TTL_MS);
  }

  const presences = await prisma.presence.findMany({
    where: { projectId, lastSeenAt: { gt: since } },
    orderBy: { lastSeenAt: 'desc' },
  });

  return NextResponse.json({ presences, since: since.toISOString() });
}
