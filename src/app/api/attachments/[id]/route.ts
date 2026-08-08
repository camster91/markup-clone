// GET /api/attachments/[id]
//
// Read-only fetch of a single attachment's bytes. Used by the
// dashboard's PinThread to render <img> tags for image attachments
// and (later) the share view's PinThread to do the same for
// public-share viewers.
//
// Auth (two surfaces):
//
//   1. An authenticated caller with access to the owning project.
//
//   2. A token-bound HttpOnly cookie issued by the managed share opener.
//      The route validates the cookie against the Attachment's Comment →
//      Pin → Screenshot → Page → Project share configuration. A matching
//      unexpired capability grants read access; a missing / wrong cookie returns 404 (not
//      401 — we don't leak "this attachment exists, you just
//      can't see it" to a public-share probe).
//
// Content-Type: the row's stored mimeType is returned verbatim.
// We do NOT trust a query param or the URL's file extension —
// the row is the source of truth.
//
// Path-traversal defense: the storageKey in the DB is a UUID
// + short extension (no '/', '\', or '..'), but we still
// guard the join in case a future bug or hand-crafted DB row
// produces a key with a path separator. The defense mirrors
// the screenshot image route's.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { assertProjectAccessible } from '@/lib/teams';
import { requestHasShareAccess } from '@/lib/share-access';

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || '/data/attachments';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // UUID shape check (matches the Attachment / Comment / Pin id
    // shape). Rejecting early avoids a parse-error path that would
    // surface as a generic 500 from the prisma lookup.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 });
    }

    // Load the attachment with enough context to validate both
    // auth surfaces: the commentId (so we can resolve the
    // comment's pin's project's shareToken) and the storageKey
    // + mimeType (so we can serve the file). The Project → Page
    // → Screenshot → Pin → Comment → Attachment chain is the
    // shortest path that gives us the shareToken. We use
    // `select` to keep the payload tight — the route never reads
    // comment.text or pin coordinates, both of which could carry
    // PII we don't want to pull into a hot path.
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        storageKey: true,
        mimeType: true,
        size: true,
        comment: {
          select: {
            id: true,
            pin: {
              select: {
                id: true,
                screenshot: {
                  select: {
                    id: true,
                    page: {
                      select: {
                        id: true,
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
                },
              },
            },
          },
        },
      },
    });
    if (!attachment) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // === Auth check =====================================================
    // Two acceptable surfaces:
    //   1. An authenticated caller with access to the owning project.
    //   2. A token-bound managed-share cookie for this exact project link.
    //
    // The cookie is the only way a non-dashboard viewer can read the file.
    // Public HTML keeps the relative <img src> free of credentials. Without it, a
    // public-share probe gets 404, not 401: we don't leak
    // "this attachment exists" to a token-less scraper.
    //
    // A matching cookie capability avoids the session lookup. Otherwise the
    // caller must pass the same project-access gate as project data routes.
    const project = attachment.comment?.pin?.screenshot?.page?.project;
    const shareAccessValid = !!project?.shareToken && requestHasShareAccess(
      req,
      project.shareToken,
      project.sharePasswordHash,
      project.shareExpiresAt
    );
    const projectId = attachment.projectId
      ?? attachment.comment?.pin?.screenshot?.page?.project?.id
      ?? null;
    const memberAccess = !shareAccessValid && projectId
      ? await assertProjectAccessible(projectId)
      : null;

    if (!shareAccessValid && !memberAccess?.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 404 });
    }

    // === File serve =====================================================
    // Path-traversal defense (mirror the screenshot route's). A
    // well-formed storageKey is a UUID + short extension, so this
    // check only fires on a hand-crafted DB row or a future bug
    // that writes a key with a separator. We reject before any
    // fs read so a malicious row can't read /etc/passwd.
    const storageKey = attachment.storageKey;
    if (storageKey.includes('/') || storageKey.includes('\\') || storageKey.includes('..')) {
      return NextResponse.json({ error: 'invalid storageKey' }, { status: 400 });
    }
    // Runtime uploads live on an external persistent mount and must not be
    // copied into the standalone build output by Turbopack's file tracer.
    const filePath = path.join(/* turbopackIgnore: true */ ATTACHMENTS_DIR, storageKey);
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    const buf = await readFile(/* turbopackIgnore: true */ filePath);

    // ETag for client-side caching. The ETag encodes the
    // storageKey + size so two attachments with the same id but
    // a re-written file (which shouldn't happen — the row is
    // deleted on cascade) would 304 vs 200 correctly. The
    // dashboard's <img> doesn't pass If-None-Match today, but
    // a future optimization (e.g. infinite-scroll history with
    // already-seen attachments) can use it.
    const etag = `"${attachment.id}-${storageKey}-${fileStat.size}"`;
    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'private, max-age=31536000, immutable',
          Vary: 'Cookie',
        },
      });
    }

    // Content-Length comes from the actual file on disk, not
    // the row's `size` column, so a partially-flushed write
    // (which we never produce — the writeFile is awaited) would
    // be visible to the client. The row's `size` is the
    // upload-time value; the file is the source of truth.
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': fileStat.size.toString(),
        // Attachments are immutable once written — no update
        // path, no PATCH. Cache-Control is the same immutable
        // year-long max-age the screenshot route uses.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Vary': 'Cookie',
        'ETag': etag,
      },
    });
  } catch (error) {
    // A missing file (e.g. the row exists but the on-disk
    // PNG was pruned by hand) is reported as 404, the same
    // shape the screenshot image route returns. Any other
    // error (DB, fs) is also 404 so we don't leak internal
    // details to a public probe.
    console.error('Attachment serve error:', error);
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
