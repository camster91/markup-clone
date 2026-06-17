// GET /api/screenshots/[id]/history
//
// Read-only history endpoint for a screenshot. Returns the last 50
// ScreenshotVersion rows for the screenshot, ordered by capturedAt desc
// (newest first). Each version carries the dims and the storageKey —
// the client renders the version as a thumbnail via the existing
// /api/screenshots/[id]/image endpoint, which serves the file at
// SCREENSHOTS_DIR/<storageKey>.png.
//
// Auth: dashboard origin OR no-auth. The /api/screenshots/[id]/image
// route is open (a Screenshot's id is a UUID — unguessable; the share
// link is the dashboard's chosen access mechanism for non-dashboard
// viewers). The history endpoint follows the same access model: any
// caller with a screenshot id can read its history. The dashboard
// makes this call from the operator's browser; the public share view
// (/share/[token]) also makes it from the viewer's browser. The
// recapture route that WRITES the version rows is dashboard-origin
// gated, so an unprivileged viewer cannot fabricate history rows.
//
// Response shape (200):
//   {
//     screenshotId: string,
//     versions: Array<{
//       id: string,
//       capturedAt: string,   // ISO
//       width: number,
//       height: number,
//       storageKey: string,
//       createdBy: string,
//     }>
//   }
//
// The client renders a thumbnail per row by hitting
//   /api/screenshots/[id]/image?v=<capturedAt-ms>
// (the /image endpoint reads the Screenshot's storageKey, which is the
// LATEST version's storageKey; for older versions the client should
// include the version's storageKey via a query param. To keep the
// /image endpoint's contract unchanged, the HistoryPanel uses a
// lightweight approach: it requests the version's PNG via a
// per-version URL — see HistoryPanel.tsx for the contract.)

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateScreenshotId } from '@/lib/validation';
import { isDashboardOrigin } from '@/lib/auth';

// Cap at 50 — the task's explicit limit. Larger windows would
// require pagination; the dashboard's HistoryPanel only renders
// 50 thumbnails at once, so anything beyond is wasted bandwidth.
const HISTORY_LIMIT = 50;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const idRes = validateScreenshotId(id);
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  // Soft auth: same access model as /api/screenshots/[id]/image
  // (open to anyone with the UUID). The recapture route that
  // WRITES the history rows is dashboard-origin gated. We don't
  // 401 here because the share-link viewer (a public token in the
  // URL, not a session cookie) needs the same access as the
  // dashboard operator — both render the same ScreenshotView tree,
  // and HistoryPanel sits inside it. The dashboard-origin check
  // is left in for defensive logging (and to be flipped to a hard
  // gate if we later add a per-viewer share-token header).
  const dashboardOrigin = isDashboardOrigin(_req);
  if (!dashboardOrigin) {
    // Best-effort audit: a non-dashboard-origin read of a
    // screenshot's history is logged so an operator can spot a
    // share link being scraped. Fire-and-forget; a failed write
    // doesn't fail the read.
    try {
      const { audit } = await import('@/lib/audit');
      audit({
        actor: 'anonymous',
        action: 'screenshot.history.read',
        target: id,
        metadata: { dashboardOrigin: false },
      });
    } catch {
      // audit module or prisma unavailable; ignore.
    }
  }

  // Verify the screenshot exists; the cascade from Screenshot →
  // ScreenshotVersion means a missing screenshot has no history
  // either, and the client should be able to distinguish "no
  // history yet" (200 with empty array) from "no such screenshot"
  // (404).
  const ss = await prisma.screenshot.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!ss) {
    return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
  }

  const versions = await prisma.screenshotVersion.findMany({
    where: { screenshotId: id },
    orderBy: { capturedAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      capturedAt: true,
      width: true,
      height: true,
      storageKey: true,
      createdBy: true,
    },
  });

  return NextResponse.json({
    screenshotId: id,
    versions: versions.map((v) => ({
      id: v.id,
      capturedAt: v.capturedAt.toISOString(),
      width: v.width,
      height: v.height,
      storageKey: v.storageKey,
      createdBy: v.createdBy,
    })),
  });
}
