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
// Auth: requireDashboardOrigin. The dashboard is the only mint
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
import { requireDashboardOrigin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || '/data/attachments';
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB

// Closed set of supported attachment kinds. The schema column is
// free-form (NOT a Prisma enum) so we can add a new kind in a single
// edit without a migration; the route enforces membership here.
//
// `image` — pasted screenshots (PNG, JPEG, WebP, GIF).
// `voice` — voice notes (not yet implemented in the UI; reserved).
// `video` — screen recordings (not yet implemented in the UI; reserved).
const KINDS = ['image', 'voice', 'video'] as const;
type Kind = typeof KINDS[number];

// Map a MIME type to a kind. The route only accepts 'image' this
// round, but the mapping exists so a future voice/video flow can
// dispatch on type without re-deriving the kind from the form field.
function kindForMime(mime: string): Kind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'voice';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

// Map a kind to a default file extension. Used to build the
// storageKey so the on-disk file has a sensible extension. The
// extension is purely cosmetic — the GET route serves the file
// with the mimeType stored in the row, not based on the filename.
function extForKind(kind: Kind, mime: string): string {
  // Common image types — most browsers paste PNG or JPEG. WebP and
  // GIF are also seen. Anything else falls back to the type's
  // subtype (e.g. 'image/svg+xml' → 'svg+xml') or to the kind name
  // if there's no '/' at all.
  if (kind === 'image') {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/svg+xml') return 'svg';
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

  // Auth: dashboard origin only. The widget never uploads
  // attachments and the share view is read-only, so a 401 for any
  // non-dashboard caller is the right call.
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const form = await req.formData();
    const commentIdRaw = form.get('commentId') as string | null;
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
        select: { id: true },
      });
      if (!comment) {
        return NextResponse.json({ error: 'comment not found' }, { status: 404 });
      }
      commentIdToBind = commentIdRaw;
    }

    // MIME → kind dispatch. The route only accepts 'image' in this
    // round; voice / video are reserved for a future surface. A
    // non-image MIME returns 415 with a clear message — the
    // dashboard's paste handler should never produce this in
    // practice (a clipboard image comes through as image/png on
    // every modern browser), but if a future "upload a file"
    // button lets the user pick a .pdf by mistake, we fail loud.
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
          // Content-Type. The share view appends `?share=<token>`
          // (the attachment route recognizes the token for
          // non-dashboard callers).
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
