// POST /api/attachments
//
// Upload an attachment (image, voice, video) for a Comment. The first
// surface is screenshots pasted from the dashboard reviewer's clipboard
// into the PinThread reply form; the route is generic enough to host
// voice / video follow-ups once the UI supports them.
//
// Body: multipart/form-data with:
//   - file (required): the binary. The route validates `file.type`
//     against the `kind` field (closed set below) and rejects
//     anything that doesn't match.
//   - projectId (required): the project that owns the upload. Access is
//     checked before bytes are written and the ownership is persisted so
//     the later comment claim cannot cross project boundaries.
//   - commentId (optional): the Comment this attachment belongs to.
//     When present, the route verifies the row exists so a bad
//     commentId is a 404, not a 500 from the FK constraint on
//     insert. When absent, the attachment is created as an
//     "orphan" (commentId = null) and the Comment.create route
//     binds it via `connect: [{ id }]` at comment-create time.
//
//     The orphan path is what the dashboard's paste handler uses:
//     the user pastes an image, the upload lands immediately, and
//     the user clicks Reply — the comment is then created with
//     the attachmentId in the same batch. This keeps the upload
//     roundtrip independent of the comment-create roundtrip (a
//     network blip on one doesn't fail the other).
//
// Auth: authenticated dashboard session plus project access. The dashboard is the only mint
// surface — the widget never uploads attachments (it posts a
// pin+screenshot at most, and the screenshot goes through its own
// /api/pins route), and the /share/[token] view is read-only.
//
// Validation:
//   - file.type must be image/* (this round) — the kind column on the
//     Attachment row accepts 'image' | 'voice' | 'video', but the
//     route rejects anything that isn't image/* until the
//     audio/video surfaces exist. This keeps the schema flexible
//     (no migration needed when we add voice) without exposing
//     arbitrary MIME types today.
//   - file.size ≤ 8MB. Same cap as the screenshot route, so a
//     paste-a-screenshot gesture and a pin-create gesture use the
//     same mental model. The cap is enforced BEFORE the bytes are
//     read into memory so a 50MB upload fails fast (the size is on
//     the File object).
//
// Storage: the file is written to ATTACHMENTS_DIR/<storageKey>. The
// directory defaults to /data/attachments (the bind-mount in
// docker-compose) and is created on demand so first-run deploys
// don't 500. The storageKey is a fresh UUID + the file's extension
// so two uploads can't collide and so a path-traversal probe in
// the GET route is confined to single-segment filenames (UUIDs
// don't contain '/', '\', or '..').

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { validateProjectId } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/teams';

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || '/data/attachments';
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB

// Closed set of supported attachment kinds. The schema column is
// free-form (NOT a Prisma enum) so we can add a new kind in a single
// edit without a migration; the route enforces membership here.
//
// `image` — pasted screenshots (PNG, JPEG, WebP, GIF). SVG is
// explicitly rejected (XSS via inline SVG when served).
// `voice` — voice notes (not yet implemented in the UI; reserved).
// `video` — screen recordings (not yet implemented in the UI; reserved).
type Kind = 'image' | 'voice' | 'video';

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// Map a MIME type to a kind. The route only accepts allowlisted image
// types this round; voice / video remain reserved.
function kindForMime(mime: string): Kind | null {
  if (ALLOWED_IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('audio/')) return 'voice';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

// Map a kind to a default file extension. Used to build the
// storageKey so the on-disk file has a sensible extension. The
// extension is purely cosmetic — the GET route serves the file
// with the mimeType stored in the row, not based on the filename.
function extForKind(kind: Kind, mime: string): string {
  if (kind === 'image') {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/webp') return 'webp';
    return 'img';
  }
  if (kind === 'voice') {
    if (mime === 'audio/webm') return 'webm';
    if (mime === 'audio/ogg') return 'ogg';
    if (mime === 'audio/mpeg') return 'mp3';
    if (mime === 'audio/wav') return 'wav';
    return 'audio';
  }
  if (kind === 'video') {
    if (mime === 'video/webm') return 'webm';
    if (mime === 'video/mp4') return 'mp4';
    return 'video';
  }
  return 'bin';
}

export async function POST(req: Request) {
  // Validate Content-Type up front. `req.formData()` throws on
  // anything other than multipart/form-data (or
  // application/x-www-form-urlencoded), and that error would
  // otherwise be caught and returned as a 500 — masking what is
  // really a malformed request. Same defense as /api/pins.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Content-Type must be multipart/form-data' },
      { status: 415 }
    );
  }

  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const form = await req.formData();
    const commentIdRaw = form.get('commentId') as string | null;
    const projectIdRaw = form.get('projectId');
    const file = form.get('file') as File | null;

    // === Input validation ===
    if (!file) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'file is empty' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }

    const projectIdRes = validateProjectId(projectIdRaw);
    if (!projectIdRes.ok) {
      return NextResponse.json({ error: projectIdRes.error }, { status: 400 });
    }
    const projectAccess = await assertProjectAccessible(projectIdRes.value);
    if (!projectAccess.ok) {
      return NextResponse.json(
        { error: projectAccess.error },
        { status: projectAccess.status }
      );
    }

    // commentId is optional. When present, the route validates
    // it's a UUID AND the row exists; the row-existence check
    // is what makes "POST a comment with an attachmentId that
    // doesn't exist" a 404 instead of an FK violation at insert.
    // When absent, the attachment is created as an "orphan"
    // (commentId IS NULL) — the comment-create route binds it
    // via `connect: [{ id }]` at comment-create time.
    //
    // A malformed commentId (e.g. "not-a-uuid") is a 400 even
    // when the form intends to omit the field, so the route
    // short-circuits on shape before hitting the DB. An empty
    // string is treated as "not provided" — browsers can
    // include an empty field for a non-submitted input.
    let commentIdToBind: string | null = null;
    if (commentIdRaw && commentIdRaw.length > 0) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commentIdRaw)) {
        return NextResponse.json({ error: 'commentId must be a UUID' }, { status: 400 });
      }
      // Verify the comment exists. A missing comment is a 404
      // (not a 500 from the FK constraint on insert). We don't
      // load the full row — just the id — so the lookup is a
      // unique-index point read.
      const comment = await prisma.comment.findUnique({
        where: { id: commentIdRaw },
        select: {
          id: true,
          pin: {
            select: {
              screenshot: {
                select: { page: { select: { projectId: true } } },
              },
            },
          },
        },
      });
      if (!comment) {
        return NextResponse.json({ error: 'comment not found' }, { status: 404 });
      }
      if (comment.pin.screenshot.page.projectId !== projectIdRes.value) {
        return NextResponse.json(
          { error: 'comment does not belong to the requested project' },
          { status: 403 }
        );
      }
      commentIdToBind = commentIdRaw;
    }

    // MIME → kind dispatch. Only png/jpeg/gif/webp are accepted;
    // image/svg+xml and any other image/* are rejected (SVG can
    // execute script when served with the wrong Content-Type or
    // when embedded). Voice / video remain reserved.
    if (file.type === 'image/svg+xml') {
      return NextResponse.json(
        { error: 'unsupported file type: image/svg+xml' },
        { status: 415 }
      );
    }
    const kind = kindForMime(file.type);
    if (kind === null) {
      return NextResponse.json(
        { error: `unsupported file type: ${file.type || '(empty)'}` },
        { status: 415 }
      );
    }
    if (kind !== 'image') {
      return NextResponse.json(
        { error: `attachment kind '${kind}' is not yet supported` },
        { status: 415 }
      );
    }

    // Read the bytes once. The 8MB cap above means the buffer is
    // bounded; the route returns 413 before reaching this line for
    // any larger upload.
    const bytes = Buffer.from(await file.arrayBuffer());

    // Generate a fresh storageKey per upload. The UUID keeps two
    // concurrent uploads from colliding, and the extension keeps
    // the on-disk file self-describing for a human poking around
    // in /data/attachments. The GET route's path-traversal guard
    // relies on storageKey being a single-segment filename (no
    // '/', '\', or '..'), which a UUID + short extension satisfies.
    const attachmentId = crypto.randomUUID();
    const ext = extForKind(kind, file.type);
    const storageKey = `${attachmentId}.${ext}`;

    // Write the file. mkdir(recursive: true) is idempotent and
    // cheap, so we always issue it (the bind-mount is already
    // there in production, but a local dev run might not have
    // /data/attachments until the first POST). On any write error
    // we 500 — no DB row is written if the file write fails, so the
    // attachment id is "spent" but the storage is consistent (no
    // orphan Attachment row pointing at a missing file).
    await mkdir(ATTACHMENTS_DIR, { recursive: true });
    await writeFile(path.join(ATTACHMENTS_DIR, storageKey), bytes);

    // Insert the row. The mimeType is stored verbatim (browsers
    // recognize `image/png` and `image/jpeg` for the two common
    // clipboard cases; storing the full type keeps the GET route's
    // Content-Type header faithful to what was uploaded).
    //
    // commentId is null when the form omitted it (the dashboard's
    // paste-then-submit flow uploads first, then creates the
    // comment). When null, the attachment is "orphan" until the
    // /api/pins/[id]/comments route runs `connect: [{ id }]` to
    // bind it. The cascade from Comment → Attachment is preserved
    // for the non-null case (deleting a Comment removes its
    // attachments).
    const attachment = await prisma.attachment.create({
      data: {
        id: attachmentId,
        commentId: commentIdToBind,
        projectId: projectIdRes.value,
        kind,
        storageKey,
        mimeType: file.type,
        size: file.size,
      },
      select: { id: true, kind: true, size: true },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: attachment.id,
          // The relative URL the dashboard puts in <img src>. The
          // GET route serves the file with the right
          // Content-Type. Managed public review access is carried by an
          // HttpOnly cookie, so this URL never contains the share token.
          url: `/api/attachments/${attachment.id}`,
          kind: attachment.kind,
          size: attachment.size,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Attachment create error:', error);
    return NextResponse.json({ error: 'Failed to create attachment' }, { status: 500 });
  }
}
