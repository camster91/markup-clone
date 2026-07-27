import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isDashboardOrigin } from '@/lib/auth';
import { validateScreenshotId } from '@/lib/validation';
import { readFile, stat } from 'fs/promises';
import path from 'path';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

// GET /api/screenshots/[id]/image
//
// Serves the PNG for a screenshot (or a specific ScreenshotVersion
// via ?storageKey=). Auth mirrors /api/attachments/[id]:
//
//   1. Dashboard origin (Origin / sec-fetch-site same-origin).
//   2. ?share=<token> matching the screenshot's project's shareToken.
//
// Unauthorized and missing both return 404 so a probe cannot tell
// whether a screenshot UUID exists. Dashboard responses use a
// private Cache-Control; share-token responses may stay immutable.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idRes = validateScreenshotId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const ss = await prisma.screenshot.findUnique({
      where: { id },
      select: {
        id: true,
        storageKey: true,
        capturedAt: true,
        page: {
          select: {
            project: {
              select: { shareToken: true },
            },
          },
        },
      },
    });
    if (!ss) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // === Auth ===========================================================
    // Dashboard origin OR matching ?share= token. 404 (not 401) on
    // failure so existence is not leaked to anonymous probes.
    const dashboard = isDashboardOrigin(req);
    const url = new URL(req.url);
    const shareToken = url.searchParams.get('share');
    const projectShareToken = ss.page?.project?.shareToken ?? null;
    const shareTokenValid = !!shareToken && shareToken === projectShareToken;

    if (!dashboard && !shareTokenValid) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Optional ?storageKey=<key>: serves a specific version's PNG
    // instead of the Screenshot's current "latest pointer". Used by
    // the HistoryPanel to render thumbnails for older versions —
    // each ScreenshotVersion row carries its own storageKey (a
    // fresh UUID per recapture), and the panel passes that key in
    // to fetch the right file. Without this param the endpoint
    // serves the Screenshot's latest PNG (the dashboard's
    // ScreenshotView relies on this default).
    //
    // Security: we look up the requested key against the
    // ScreenshotVersion rows for THIS screenshot, so a caller
    // can't pass a storageKey belonging to a different screenshot
    // and read someone else's PNG. If the key doesn't match any
    // version, we 404 (defense against probing).
    const requestedKey = url.searchParams.get('storageKey');
    let storageKey = ss.storageKey;
    let versionCapturedAt: Date | null = null;
    if (requestedKey && requestedKey !== ss.storageKey) {
      // Path-traversal defense: storageKey is constrained to
      // single-segment filenames by the recapture script (a UUID
      // + ".png"), so a key with "/" or ".." would be a hostile
      // call. Reject before any fs read.
      if (requestedKey.includes('/') || requestedKey.includes('\\') || requestedKey.includes('..')) {
        return NextResponse.json({ error: 'invalid storageKey' }, { status: 400 });
      }
      const version = await prisma.screenshotVersion.findUnique({
        where: { storageKey: requestedKey },
        select: { screenshotId: true, capturedAt: true, storageKey: true },
      });
      if (!version || version.screenshotId !== id) {
        return NextResponse.json({ error: 'version not found' }, { status: 404 });
      }
      storageKey = version.storageKey;
      versionCapturedAt = version.capturedAt;
    }

    const filePath = path.join(SCREENSHOTS_DIR, storageKey);
    const fileStat = await stat(filePath);
    const buf = await readFile(filePath);

    // ETag for caching. Includes the storageKey so two different
    // versions' PNGs don't share an ETag (the dashboard's
    // ScreenshotView's `?v=<imageKey>` query is the cache buster;
    // here we let the ETag do the work for the HistoryPanel's
    // thumbnails).
    const etag = versionCapturedAt
      ? `"${id}-${versionCapturedAt.getTime()}-${storageKey}"`
      : `"${id}-${ss.capturedAt.getTime()}"`;

    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304 });
    }

    // Dashboard: private cache. Share-token viewers: immutable is
    // fine (the storageKey is content-addressed / versioned).
    const cacheControl = dashboard
      ? 'private, max-age=3600'
      : 'public, max-age=31536000, immutable';

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': cacheControl,
        'ETag': etag,
      },
    });
  } catch (error) {
    console.error('Screenshot serve error:', error);
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
