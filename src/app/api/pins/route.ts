import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireProjectKey } from '@/lib/auth';
import { writeFile, mkdir, rename } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { sendSubscriberEmails } from '@/lib/email';
import { dispatch } from '@/lib/integrations/dispatcher';
import type { PinPayload } from '@/lib/integrations/types';
import {
  LIMITS,
  validatePagePath,
  validatePercent,
  validatePinText,
  sanitizeText,
} from '@/lib/validation';
import { consume } from '@/lib/rate-limit';
import { emit } from '@/lib/events';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(req: Request) {
  // Validate Content-Type up front. `req.formData()` throws on anything
  // other than multipart/form-data (or application/x-www-form-urlencoded),
  // and that error would otherwise be caught and returned as a 500 — masking
  // what is really a malformed request.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Content-Type must be multipart/form-data' },
      { status: 415 }
    );
  }

  try {
    const form = await req.formData();
    const projectId = form.get('projectId') as string | null;
    const pathRaw = (form.get('path') as string | null) || '/';
    const xPercent = parseFloat(form.get('xPercent') as string);
    const yPercent = parseFloat(form.get('yPercent') as string);
    const elementXPath = (form.get('elementXPath') as string | null) || null;
    const elementHTML = (form.get('elementHTML') as string | null) || null;
    const screenshot = form.get('screenshot') as File | null;
    const textRaw = (form.get('text') as string | null) || '';
    const authorNameRaw = (form.get('authorName') as string | null) || 'Client';

    // === Input validation (returns 400 with a specific error message) ===
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    if (!screenshot) return NextResponse.json({ error: 'screenshot required' }, { status: 400 });
    if (screenshot.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: 'screenshot too large' }, { status: 413 });
    }

    const pathRes = validatePagePath(pathRaw);
    if (!pathRes.ok) return NextResponse.json({ error: pathRes.error }, { status: 400 });
    const path_ = pathRes.value;

    const xRes = validatePercent(xPercent, 'xPercent');
    if (!xRes.ok) return NextResponse.json({ error: xRes.error }, { status: 400 });
    const yRes = validatePercent(yPercent, 'yPercent');
    if (!yRes.ok) return NextResponse.json({ error: yRes.error }, { status: 400 });

    // Pin text is optional. An empty/missing form field is allowed (the
    // user can post a pin with no comment). When the field IS present,
    // validatePinText enforces the 1-2000 char limit after trimming
    // and rejects null bytes — the caller's `.trim()` is no longer
    // needed because the validator does it.
    let text = '';
    if (typeof textRaw === 'string' && textRaw.length > 0) {
      const textRes = validatePinText(textRaw);
      if (!textRes.ok) return NextResponse.json({ error: textRes.error }, { status: 400 });
      text = textRes.value;
    }

    const authorRes = sanitizeText(authorNameRaw, LIMITS.AUTHOR_NAME_MAX, 'authorName');
    if (!authorRes.ok) return NextResponse.json({ error: authorRes.error }, { status: 400 });
    const authorName = authorRes.value;

    // Validate optional element fields if present
    if (elementXPath && elementXPath.length > LIMITS.ELEMENT_XPATH_MAX) {
      return NextResponse.json({ error: `elementXPath must be ≤${LIMITS.ELEMENT_XPATH_MAX} chars` }, { status: 400 });
    }
    if (elementHTML && elementHTML.length > LIMITS.ELEMENT_HTML_MAX) {
      return NextResponse.json({ error: `elementHTML must be ≤${LIMITS.ELEMENT_HTML_MAX} chars` }, { status: 400 });
    }

    // Widget auth: project apiKey via X-Api-Key header
    const authErr = await requireProjectKey(req, projectId);
    if (authErr) return authErr;

    // Rate limit by IP + projectId: 30 tokens, 1 per 10 seconds.
    // Note: rate-limit state is in-process (see src/lib/rate-limit.ts).
    // Fine for the current single-instance deploy; will not share buckets
    // across instances if we ever scale horizontally.
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    const rateLimitKey = `${ip}:${projectId}`;
    const rateLimit = consume(rateLimitKey, { maxTokens: 30, refillRate: 0.1 });
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterSec: rateLimit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
      );
    }

    // Ensure project + page exist
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

    const page = await prisma.page.upsert({
      where: { projectId_path: { projectId, path: path_ } },
      update: {},
      create: { projectId, path: path_ },
    });

    // Read screenshot dimensions from PNG header
    const bytes = Buffer.from(await screenshot.arrayBuffer());
    const dimensions = readPngDimensions(bytes);

    // Write-then-rename pattern. We stage the PNG as `<id>.tmp.<rand>` and
    // only atomically rename to `<id>.png` after the DB transaction commits.
    // If the tx fails, we unlink the temp file in the catch — no orphan files
    // pile up in /data/screenshots on DB outages. The temp name uses a random
    // suffix so two concurrent writes for the same screenshotId (UUID, but
    // belt-and-suspenders) can't collide.
    const screenshotId = crypto.randomUUID();
    const storageKey = `${screenshotId}.png`;
    const tempKey = `${screenshotId}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    const tempPath = path.join(SCREENSHOTS_DIR, tempKey);
    const finalPath = path.join(SCREENSHOTS_DIR, storageKey);
    await writeFile(tempPath, bytes);

    // Create screenshot, pin, and first comment in one transaction
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const ss = await tx.screenshot.create({
          data: {
            id: screenshotId,
            pageId: page.id,
            storageKey,
            width: dimensions.width,
            height: dimensions.height,
          },
        });
        const pin = await tx.pin.create({
          data: {
            screenshotId: ss.id,
            xPercent,
            yPercent,
            elementXPath: elementXPath || undefined,
            elementHTML: elementHTML || undefined,
            authorName,
            comments: text
              ? {
                  create: {
                    author: authorName,
                    authorRole: 'client',
                    text,
                  },
                }
              : undefined,
          },
          include: { comments: true },
        });
        return { screenshot: ss, pin };
      });
      // Tx committed — atomically promote the temp file to the final name.
      // rename(2) is atomic on the same filesystem; readers (GET /api/screenshots/...)
      // either see the old file (and 304) or the new one, never a half-written one.
      await rename(tempPath, finalPath);
    } catch (txErr) {
      // Tx failed: remove the temp file so /data/screenshots doesn't fill up.
      const { unlink } = await import('fs/promises');
      try { await unlink(tempPath); } catch { /* may not exist */ }
      throw txErr;
    }

    // Fire-and-forget email notification — query subscribers after tx commits,
    // then send without blocking the response.
    const pid = project.id;
    void prisma.subscriber
      .findMany({ where: { projectId: pid }, select: { email: true } })
      .then((subs) =>
        sendSubscriberEmails({
          projectName: project.name,
          path: path_,
          commentText: text,
          subscriberEmails: subs.map((s) => s.email),
        })
      )
      .catch((err) => console.error('[email] subscriber lookup error:', err));

    // Fire-and-forget integration dispatch. After a new pin is
    // committed, look up every integration configured for the
    // project and fan the pin payload out to each adapter
    // (Slack / Discord / generic webhook). The dispatch is
    // strictly non-blocking: we don't await the dispatch
    // chain, and the inner dispatcher's errors are caught
    // per-integration so a failing webhook can never take
    // down the others. The outcome of each call is recorded
    // on its Integration row (lastSuccessAt / lastError /
    // lastErrorAt) so the dashboard's ProjectSettings UI can
    // show "last success at X" or "last error: Y" per
    // integration. The pin POST itself never bubbles an
    // integration error to the client.
    void dispatchIntegrationsForPin({
      projectId: pid,
      projectName: project.name,
      domain: project.domain,
      pinId: result.pin.id,
      screenshotId: result.screenshot.id,
      xPercent: result.pin.xPercent,
      yPercent: result.pin.yPercent,
      pinStatus: result.pin.status,
      authorName: result.pin.authorName,
      pinCreatedAt: result.pin.createdAt,
      path: path_,
      commentText: text,
    });

    // Live update: broadcast a new-pin event to the SSE channel for
    // any dashboard open on this project. The payload is a SAFE
    // projection — no apiKey, no full project row, no raw text blob
    // that could include XSS payloads the dashboard would then have
    // to re-render. The dashboard's ScreenshotView hook decides
    // whether to optimistically insert the pin (it checks the
    // screenshotId against the currently-viewed screenshot).
    //
    // emit() is synchronous and fire-and-forget — a slow or broken
    // SSE client must not block the response, and emit() catches
    // subscriber throws internally.
    emit({
      type: 'new-pin',
      projectId: pid,
      payload: {
        pin: {
          id: result.pin.id,
          screenshotId: result.screenshot.id,
          xPercent: result.pin.xPercent,
          yPercent: result.pin.yPercent,
          status: result.pin.status,
          authorName: result.pin.authorName,
          createdAt: result.pin.createdAt instanceof Date
            ? result.pin.createdAt.toISOString()
            : String(result.pin.createdAt),
        },
      },
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('Pin create error:', error);
    return NextResponse.json({ error: 'Failed to create pin' }, { status: 500 });
  }
}

// Read width/height from a PNG buffer (bytes 16-23 of the IHDR chunk)
function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG signature is 8 bytes, IHDR length is 4 bytes, "IHDR" is 4 bytes, then 4 bytes width + 4 bytes height
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    return { width: 0, height: 0 };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

// `dispatchIntegrationsForPin` is the fire-and-forget bridge
// between the pin route and the integration adapter layer.
//
// Lifecycle:
//   1. The pin route commits the new Pin + Screenshot, then
//      `void` calls this function — the response returns to
//      the widget immediately, without awaiting the dispatch.
//   2. This function queries every integration row for the
//      project, builds a safe `PinPayload` projection, and
//      fires the adapter for each. We `Promise.all` the
//      per-integration work, but we do NOT await the whole
//      chain from the route — see the `void` above.
//   3. Each integration's outcome is recorded on its own
//      row (lastSuccessAt OR lastError + lastErrorAt) so a
//      failure on one integration never poisons the others.
//   4. Any uncaught error in the dispatch loop is logged
//      but never thrown — the promise resolves to a
//      no-op so the fire-and-forget pattern stays clean.
//
// The function is intentionally NOT exported from this
// file — it's a private helper for the pin route.
async function dispatchIntegrationsForPin(args: {
  projectId: string;
  projectName: string;
  domain: string;
  pinId: string;
  screenshotId: string;
  xPercent: number;
  yPercent: number;
  pinStatus: string;
  authorName: string;
  // The DB returns a Date for createdAt; the SSE payload
  // serialises it to an ISO string. We accept either so
  // the caller doesn't need to re-shape the value.
  pinCreatedAt: Date | string;
  path: string;
  commentText: string;
}): Promise<void> {
  try {
    const integrations = await prisma.integration.findMany({
      where: { projectId: args.projectId },
      select: { id: true, kind: true, configJson: true },
    });
    if (integrations.length === 0) return;

    // Coerce createdAt to an ISO string once so the per-adapter
    // payload is consistent. The Date branch covers the live
    // route; the string branch keeps the helper testable from
    // a hand-built call.
    const createdAtIso =
      args.pinCreatedAt instanceof Date
        ? args.pinCreatedAt.toISOString()
        : String(args.pinCreatedAt);

    const payload: PinPayload = {
      pin: {
        id: args.pinId,
        screenshotId: args.screenshotId,
        xPercent: args.xPercent,
        yPercent: args.yPercent,
        status: args.pinStatus,
        authorName: args.authorName,
        createdAt: createdAtIso,
      },
      project: {
        id: args.projectId,
        name: args.projectName,
        domain: args.domain,
      },
      path: args.path,
      commentText: args.commentText,
    };

    // Per-integration dispatch. We Promise.all so the
    // independent adapter calls overlap (an operator can
    // have Slack + Discord + a custom webhook all on the
    // same project). Each inner step catches its own
    // errors — see the .then/.catch below.
    await Promise.all(
      integrations.map(async (integration) => {
        // Parse the stored configJson. A malformed value
        // would have slipped past the POST /integrations
        // validator; we treat it as a "config invalid"
        // error on the row and skip the dispatch rather
        // than fire a half-configured request.
        let config: unknown;
        try {
          config = JSON.parse(integration.configJson);
        } catch (e) {
          console.error(
            `[integrations] configJson parse error for ${integration.id}:`,
            e
          );
          await prisma.integration.update({
            where: { id: integration.id },
            data: {
              lastError: 'Stored config is not valid JSON',
              lastErrorAt: new Date(),
            },
          });
          return;
        }

        // kind is a free-form string in the DB; the
        // dispatcher only knows the closed set. A row with
        // a typo'd kind is the caller's bug, not ours —
        // log + record the error on the row.
        if (
          integration.kind !== 'slack' &&
          integration.kind !== 'discord' &&
          integration.kind !== 'webhook'
        ) {
          console.error(
            `[integrations] unknown kind "${integration.kind}" for ${integration.id}`
          );
          await prisma.integration.update({
            where: { id: integration.id },
            data: {
              lastError: `Unknown integration kind: ${integration.kind}`,
              lastErrorAt: new Date(),
            },
          });
          return;
        }

        const result = await dispatch(
          integration.kind,
          config,
          payload
        );
        if (result.ok) {
          await prisma.integration.update({
            where: { id: integration.id },
            data: {
              lastSuccessAt: new Date(),
              lastError: null,
              lastErrorAt: null,
            },
          });
        } else {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { lastError: result.error, lastErrorAt: new Date() },
          });
        }
      })
    );
  } catch (err) {
    // Defensive net — the inner steps should already have
    // caught everything, but a DB outage in the findMany
    // would bubble up here. Log and swallow; the pin POST
    // is long since returned to the client.
    console.error('[integrations] dispatch loop error:', err);
  }
}
