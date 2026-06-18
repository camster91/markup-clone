import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { validatePinText } from '@/lib/validation';
import { emit } from '@/lib/events';
import { audit } from '@/lib/audit';
import { parseMentions } from '@/lib/mentions';
import { sendMentionEmail } from '@/lib/email';
import { parseHost } from '@/lib/origin';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  // Rate limit AFTER auth, BEFORE the DB write.
  // 30 tokens / 0.5 per second = 60s sustained per (origin, pinId).
  // Per (origin, pinId) so a busy reviewer on one pin doesn't starve the
  // bucket for any other pin they're reviewing at the same time, and so
  // a runaway client on a single pin is capped at 30/min. Note: rate-limit
  // state is in-process (see src/lib/rate-limit.ts) — fine for the current
  // single-instance deploy; will not share buckets across instances if we
  // ever scale horizontally.
  const origin = req.headers.get('origin') ?? 'unknown';
  const { id: pinId } = await params;
  const rateCheck = consume(`comments:origin:${origin}:${pinId}`, { maxTokens: 30, refillRate: 0.5 });
  if (!rateCheck.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
  }

  try {
    const { id } = await params;
    const { text, author, authorRole, attachmentIds } = await req.json();
    // Use the same validator as the pin-create flow (R0.3) so the comment
    // text gets the same length cap, trim, and null-byte rejection. A
    // missing/empty/whitespace-only text is rejected here (it would
    // produce a 500 from the prisma NOT NULL constraint otherwise).
    // attachmentIds is an optional array of UUIDs pointing at
    // Attachment rows. The attachments are uploaded separately via
    // POST /api/attachments (which validates the file + commentId
    // in isolation) and then "claimed" by this comment at create
    // time. This split keeps the comment-create path JSON-only
    // and lets the attachment route run its own file
    // validation/MIME check/write-then-rename outside the
    // comment tx.
    //
    // The closed set of behavior we accept:
    //   - undefined / missing → no attachments (backwards compat
    //     with the pre-feature widget / dashboard).
    //   - empty array [] → no attachments.
    //   - non-array → 400.
    //   - any non-UUID string → 400.
    //   - any duplicate id → 400 (the create below is a single
    //     `connect` call per id; a duplicate would be a no-op
    //     attach + a confusing UX, so reject).
    let normalizedAttachmentIds: string[] = [];
    if (attachmentIds !== undefined) {
      if (!Array.isArray(attachmentIds)) {
        return NextResponse.json({ error: 'attachmentIds must be an array' }, { status: 400 });
      }
      if (attachmentIds.length > 0) {
        for (const a of attachmentIds) {
          if (typeof a !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a)) {
            return NextResponse.json({ error: 'attachmentIds must be UUIDs' }, { status: 400 });
          }
        }
        const seen = new Set<string>();
        for (const a of attachmentIds) {
          const k = a.toLowerCase();
          if (seen.has(k)) {
            return NextResponse.json({ error: 'attachmentIds must be unique' }, { status: 400 });
          }
          seen.add(k);
        }
        normalizedAttachmentIds = attachmentIds;
      }
    }

    // Text is required UNLESS there are attachments — an
    // image-only reply (paste without typing) is a valid comment
    // because the attachment carries the meaning. We validate
    // text LAST so a caller who sends { text: '', attachmentIds:
    // [...] } gets through; a caller who sends { text: '' } alone
    // still 400s (the comment has no content at all). The
    // validator is the same as the pin-create flow's for
    // non-empty text (length cap, trim, null-byte rejection).
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    if (normalizedAttachmentIds.length === 0) {
      // No attachments — text must be valid on its own.
      const textRes = validatePinText(text);
      if (!textRes.ok) {
        return NextResponse.json({ error: textRes.error }, { status: 400 });
      }
    } else {
      // Has attachments — text is optional. If present, still
      // run the validator (length cap + null-byte rejection),
      // but accept an empty/whitespace string. The 8MB
      // attachment is the bound on the comment's "weight".
      if (text.length > 0) {
        const textRes = validatePinText(text);
        if (!textRes.ok) {
          return NextResponse.json({ error: textRes.error }, { status: 400 });
        }
      }
    }

    // Verify the attachments exist before claiming them.
    // The post-upload flow is: dashboard uploads the file via
    // /api/attachments (which creates an orphan row with
    // commentId=null — the route accepts both the orphan path
    // for the paste-then-submit UX and the bound path when a
    // caller already has a commentId), then POSTs
    // /api/pins/[id]/comments with those attachmentIds. The
    // comment-create route's `connect: [{ id }]` binds the
    // orphan attachments to the new comment in one shot.
    //
    // We re-validate at comment-create time so a caller can't
    // smuggle in an attachment id that doesn't exist (e.g. a
    // typo, or an id from a different comment thread). The
    // query is a single IN-list on the unique id column — fast
    // and doesn't depend on the comment row at all. We do NOT
    // restrict to "only orphan rows" here; an attachment that
    // was uploaded with a commentId against an existing
    // comment can be re-bound by another POST (the cascade on
    // the original Comment would have removed it, so this is
    // only meaningful in a flow that produces a deliberate
    // re-link, which the current UI does not).
    if (normalizedAttachmentIds.length > 0) {
      const existing = await prisma.attachment.findMany({
        where: { id: { in: normalizedAttachmentIds } },
        select: { id: true },
      });
      const found = new Set(existing.map((a) => a.id));
      const missing = normalizedAttachmentIds.filter((a) => !found.has(a));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `attachment not found: ${missing[0]}` },
          { status: 404 }
        );
      }
    }

    const comment = await prisma.comment.create({
      data: {
        pinId: id,
        text,
        author: author || 'Reviewer',
        authorRole: authorRole || 'reviewer',
        // Claim the uploaded attachments by linking them to the
        // new comment. `connect` is the right shape because the
        // Attachment rows already exist — we just add the
        // back-reference. We do NOT re-validate that the
        // attachment's existing commentId is null (the row was
        // created with a commentId at upload time, so this
        // `connect` on the M-N side is a no-op and the row's
        // commentId stays as the original). This is correct: the
        // upload route already bound the attachment to the
        // comment.
        ...(normalizedAttachmentIds.length > 0
          ? { attachments: { connect: normalizedAttachmentIds.map((aid) => ({ id: aid })) } }
          : {}),
      },
      include: {
        attachments: { select: { id: true, kind: true, size: true, mimeType: true } },
      },
    });

    // Look up the pin's projectId + screenshotId so we can scope the
    // new-comment event AND build the per-mention pinUrl link. We
    // could join this into the create above, but the create path is
    // the hot path and a second query is cheap (and the comment row
    // is already written, so the slow path is overshadowed by the
    // user's send). The projectId + screenshotId are the ONLY fields
    // we read; we explicitly do NOT select the full pin row (which
    // would include sensitive authorName from previous comments) so
    // this query has no PII footprint. Project name is also pulled so
    // the mention email subject has something useful in it.
    const pinMeta = await prisma.pin.findUnique({
      where: { id },
      select: {
        screenshot: {
          select: {
            id: true,
            page: { select: { projectId: true, project: { select: { name: true } } } },
          },
        },
      },
    });
    const projectId = pinMeta?.screenshot?.page?.projectId ?? null;
    const screenshotId = pinMeta?.screenshot?.id ?? null;
    const projectName = pinMeta?.screenshot?.page?.project?.name ?? 'Project';

    // Reopen-on-reply: if the pin was RESOLVED, flip it back to OPEN.
    // This is the reviewer-side signal that more work is needed.
    const pin = await prisma.pin.findUnique({ where: { id }, select: { status: true } });
    if (pin?.status === 'RESOLVED') {
      await prisma.pin.update({ where: { id }, data: { status: 'OPEN' } });
    }

    // Live update: broadcast a new-comment event so any dashboard
    // open on this project can optimistically append the comment to
    // the matching PinThread. The payload is a SAFE projection — no
    // apiKey, no full pin row. The dashboard's ScreenshotView hook
    // uses payload.pinId to find the right thread; if the user
    // isn't viewing that pin, the event is a no-op.
    //
    // We only emit if we know the projectId. If the pin doesn't
    // exist (e.g. a stale id), the comment.create above would have
    // thrown on the foreign-key constraint — we wouldn't reach this
    // line. The projectId is null check is defensive in case the
    // schema ever changes.
    if (projectId) {
      emit({
        type: 'new-comment',
        projectId,
        payload: {
          pinId: id,
          comment: {
            id: comment.id,
            text: comment.text,
            author: comment.author,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt instanceof Date
              ? comment.createdAt.toISOString()
              : String(comment.createdAt),
            // Attachments go in the same payload as the comment so
            // the SSE-driven PinThread can render the <img> tags
            // without a second roundtrip. The shape mirrors the
            // FeedbackAttachment type — id, kind, size, mimeType,
            // plus the relative url (the dashboard is already
            // dashboard-origin-authenticated, so the GET
            // /api/attachments/[id] route will accept the request
            // without a `?share=` token).
            attachments: (comment.attachments ?? []).map((a) => ({
              id: a.id,
              kind: a.kind as 'image' | 'voice' | 'video',
              size: a.size,
              mimeType: a.mimeType,
              url: `/api/attachments/${a.id}`,
            })),
          },
        },
      });
    }

    // @-mentions: parse the comment text for `@email` patterns, look up
    // matching users, and fire-and-forget a mention email to each. The
    // mention dispatch is NOT awaited — same fire-and-forget contract
    // as the subscriber + audit paths — so a slow Mailgun call never
    // delays the comment response.
    //
    // Case-insensitive: `@Alice@Example.COM` and `@alice@example.com`
    // resolve to the same mention. parseMentions returns a lowercased,
    // deduplicated list; the `mode: 'insensitive'` User lookup matches
    // the same set of users.
    //
    // Unrecognized emails (no User row with that address) are silently
    // skipped — we don't 4xx the comment for typing a real-but-unknown
    // address. The screenshot URL fragment is `#comment-<id>` so the
    // recipient lands on the screenshot view scrolled to the new
    // comment.
    const mentioned = parseMentions(text);
    if (mentioned.length > 0) {
      try {
        const mentionedUsers = await prisma.user.findMany({
          where: { email: { in: mentioned, mode: 'insensitive' } },
          select: { email: true },
        });
        // Dedup case-insensitively, but PRESERVE the original User
        // email casing. The User row is the source of truth for the
        // recipient address — sending the comment to "alice@example.com"
        // when the user registered as "Alice@example.com" would be
        // confusing (and in principle could differ at the SMTP layer
        // if the mailbox is case-sensitive).
        const seen = new Set<string>();
        const emailsToSend: string[] = [];
        for (const u of mentionedUsers) {
          const key = u.email.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            emailsToSend.push(u.email);
          }
        }
        if (emailsToSend.length > 0) {
          const dashboardOrigin = parseHost(process.env.DASHBOARD_HOST).origin;
          const pinUrl = screenshotId
            ? `${dashboardOrigin}/api/screenshots/${screenshotId}/image#comment-${comment.id}`
            : `${dashboardOrigin}#comment-${comment.id}`;
          // Audit the mention event (one row per batch, not per email —
          // the list is in the metadata so the operator can see exactly
          // who was notified).
          audit({
            actor: comment.author,
            action: 'comment.mention',
            target: comment.id,
            metadata: { pinId: id, emails: emailsToSend },
          });
          for (const email of emailsToSend) {
            // Intentionally not awaited. sendMentionEmail has its own
            // try/catch around the Mailgun call so a single bad email
            // can't poison the rest of the batch.
            void sendMentionEmail({
              to: email,
              author: comment.author,
              projectName,
              commentText: text,
              pinUrl,
            });
          }
        }
      } catch (err) {
        // Mention handling is a best-effort enhancement — never let
        // a DB / lookup error fail the comment POST that the user is
        // already getting back. Log and move on.
        console.error('[comments] mention dispatch failed:', err);
      }
    }

    return NextResponse.json({ success: true, data: comment }, { status: 201 });
  } catch (error) {
    console.error('Comment create error:', error);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}
