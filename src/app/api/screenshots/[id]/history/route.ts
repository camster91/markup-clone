// GET /api/screenshots/[id]/history
//
// Read-only history endpoint for a screenshot. Returns the last 50
// ScreenshotVersion rows for the screenshot, ordered by capturedAt desc
// (newest first). Each version carries the dims and the storageKey —
// the client renders the version as a thumbnail via the existing
// /api/screenshots/[id]/image endpoint, which serves the file at
// SCREENSHOTS_DIR/<storageKey>.png.
//
// Auth: authenticated project access OR the exact link's token-bound HttpOnly
// cookie (same gate as image and attachment media). Soft-allow
// for anonymous callers is intentionally removed — a screenshot UUID
// alone is not enough. Unauthorized returns 404 (not 401) so probes
// cannot distinguish "exists but forbidden" from "missing".
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
import { assertProjectAccessible } from '@/lib/teams';
import { requestHasShareAccess } from '@/lib/share-access';

// Cap at 50 — the task's explicit limit. Larger windows would
// require pagination; the dashboard's HistoryPanel only renders
// 50 thumbnails at once, so anything beyond is wasted bandwidth.
const HISTORY_LIMIT = 50;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const idRes = validateScreenshotId(id);
  if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

  // Verify the screenshot exists and load the project's shareToken
  // for the share-link auth path. Missing → 404; unauthorized →
  // also 404 (no existence leak).
  const ss = await prisma.screenshot.findUnique({
    where: { id },
    select: {
      id: true,
      page: {
        select: {
          project: {
            select: {
              id: true,
              shareToken: true,
              shareExpiresAt: true,
              sharePasswordHash: true,
            },
          },
        },
      },
    },
  });
  if (!ss) {
    return NextResponse.json({ error: 'screenshot not found' }, { status: 404 });
  }

  const project = ss.page?.project;
  const shareAccessValid = !!project?.shareToken && requestHasShareAccess(
    req,
    project.shareToken,
    project.sharePasswordHash,
    project.shareExpiresAt
  );
  const projectId = ss.page?.project?.id ?? null;
  const memberAccess = !shareAccessValid && projectId
    ? await assertProjectAccessible(projectId)
    : null;

  if (!shareAccessValid && !memberAccess?.ok) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
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

  return NextResponse.json(
    {
      screenshotId: id,
      versions: versions.map((v) => ({
        id: v.id,
        capturedAt: v.capturedAt.toISOString(),
        width: v.width,
        height: v.height,
        storageKey: v.storageKey,
        createdBy: v.createdBy,
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
  );
}
