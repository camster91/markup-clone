import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile, stat } from 'fs/promises';
import path from 'path';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ss = await prisma.screenshot.findUnique({ where: { id } });
    if (!ss) return NextResponse.json({ error: 'not found' }, { status: 404 });

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
    const requestedKey = new URL(req.url).searchParams.get('storageKey');
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

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': etag,
      },
    });
  } catch (error) {
    console.error('Screenshot serve error:', error);
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
