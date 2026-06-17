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
    const { text, author, authorRole } = await req.json();
    // Use the same validator as the pin-create flow (R0.3) so the comment
    // text gets the same length cap, trim, and null-byte rejection. A
    // missing/empty/whitespace-only text is rejected here (it would
    // produce a 500 from the prisma NOT NULL constraint otherwise).
    if (text !== undefined) {
      const textRes = validatePinText(text);
      if (!textRes.ok) {
        return NextResponse.json({ error: textRes.error }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const comment = await prisma.comment.create({
      data: {
        pinId: id,
        text,
        author: author || 'Reviewer',
        authorRole: authorRole || 'reviewer',
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
