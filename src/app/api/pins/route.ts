import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireProjectKey } from '@/lib/auth';
import { writeFile, mkdir, rename } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { sendSubscriberEmails } from '@/lib/email';
import { sendProjectMemberNotification } from '@/lib/project-notification-delivery';
import { enqueuePinCreatedEvent } from '@/lib/integrations/delivery-queue';
import { buildIssueHandoffV1 } from '@/lib/issue-handoff';
import type { Pin as FeedbackPin } from '@/lib/types';
import { parseHost } from '@/lib/origin';
import {
  LIMITS,
  validatePagePath,
  validatePercent,
  validatePinText,
  sanitizeText,
} from '@/lib/validation';
import { consume } from '@/lib/rate-limit';
import { emit } from '@/lib/events';
import { getClientIp } from '@/lib/request-ip';
import {
  normalizeBrowserContext,
  parseDeveloperContext,
  sanitizeElementSnippetHtml,
} from '@/lib/developer-context';

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
    const developerContextInput = {
      pageUrl: form.get('pageUrl'),
      viewportWidth: form.get('viewportWidth'),
      viewportHeight: form.get('viewportHeight'),
      devicePixelRatio: form.get('devicePixelRatio'),
      userAgent: form.get('userAgent'),
      platform: form.get('platform'),
      selectorCandidatesJson: form.get('selectorCandidatesJson'),
    };

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
    const ip = getClientIp(req);
    const rateLimitKey = `${ip}:${projectId}`;
    const rateLimit = consume(rateLimitKey, { maxTokens: 30, refillRate: 0.1 });
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterSec: rateLimit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
      );
    }

    // Ensure project + page exist
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        activeReviewRound: {
          select: { id: true, number: true, name: true, commentsPaused: true },
        },
      },
    });
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });
    if (project.archivedAt) {
      return NextResponse.json(
        {
          error: 'This site is archived and is not accepting new feedback',
          code: 'PROJECT_ARCHIVED',
        },
        { status: 409 }
      );
    }
    if (project.activeReviewRound?.commentsPaused) {
      return NextResponse.json(
        {
          error: 'New feedback is paused for this review round',
          code: 'NEW_FEEDBACK_PAUSED',
        },
        { status: 409 }
      );
    }
    const developerContextRes = parseDeveloperContext(developerContextInput, project.domain, path_);
    if (!developerContextRes.ok) {
      return NextResponse.json({ error: developerContextRes.error }, { status: 400 });
    }
    const developerContext = developerContextRes.value;
    const safeElementHTML = sanitizeElementSnippetHtml(elementHTML);

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
            reviewRoundId: project.activeReviewRoundId || undefined,
            xPercent,
            yPercent,
            elementXPath: elementXPath || undefined,
            elementHTML: safeElementHTML || undefined,
            pageUrl: developerContext.pageUrl,
            viewportWidth: developerContext.viewportWidth,
            viewportHeight: developerContext.viewportHeight,
            devicePixelRatio: developerContext.devicePixelRatio,
            userAgent: developerContext.userAgent,
            platform: developerContext.platform,
            selectorCandidatesJson: developerContext.selectorCandidatesJson,
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
        const buildIntegrationIssue = () => {
        const createdAt = pin.createdAt.toISOString();
        const capturedAt = ss.capturedAt.toISOString();
        const normalized = normalizeBrowserContext(developerContext.userAgent, developerContext.platform);
        const selectors = developerContext.selectorCandidatesJson
          ? JSON.parse(developerContext.selectorCandidatesJson) as string[]
          : [];
        const hasDeveloperContext = Boolean(
          developerContext.pageUrl || developerContext.viewportWidth || developerContext.viewportHeight ||
          developerContext.devicePixelRatio || developerContext.userAgent || developerContext.platform ||
          developerContext.selectorCandidatesJson || safeElementHTML || elementXPath
        );
        const issuePin: FeedbackPin = {
          id: pin.id,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          status: pin.status,
          priority: 'NONE',
          assignee: null,
          tags: [],
          elementXPath: pin.elementXPath,
          elementHTML: pin.elementHTML,
          developerContext: hasDeveloperContext ? {
            pageUrl: developerContext.pageUrl,
            route: path_,
            viewport: developerContext.viewportWidth !== null && developerContext.viewportHeight !== null
              ? {
                  width: developerContext.viewportWidth,
                  height: developerContext.viewportHeight,
                  devicePixelRatio: developerContext.devicePixelRatio,
                }
              : null,
            browser: normalized.browser,
            platform: normalized.platform,
            selectors,
            elementSnippet: safeElementHTML,
            screenshot: {
              id: ss.id,
              width: ss.width,
              height: ss.height,
              capturedAt,
            },
            reviewRound: project.activeReviewRound ? {
              id: project.activeReviewRound.id,
              number: project.activeReviewRound.number,
              name: project.activeReviewRound.name,
            } : null,
          } : null,
          createdAt,
          comments: pin.comments.map((comment) => ({
            id: comment.id,
            author: comment.author,
            authorRole: comment.authorRole,
            text: comment.text,
            createdAt: comment.createdAt.toISOString(),
            attachments: [],
          })),
          annotations: [],
        };
        return buildIssueHandoffV1({
          dashboardOrigin: parseHost(process.env.DASHBOARD_HOST).origin,
          project: { id: project.id, name: project.name, domain: project.domain },
          pagePath: path_,
          screenshot: { id: ss.id, width: ss.width, height: ss.height, capturedAt },
          pin: issuePin,
        });
        };
        await enqueuePinCreatedEvent(tx, {
          projectId: project.id,
          eventId: crypto.randomUUID(),
          occurredAt: pin.createdAt.toISOString(),
          issue: buildIntegrationIssue,
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
    const memberNotification = {
      projectId: pid,
      pinId: result.pin.id,
      event: 'new-pin' as const,
      title: 'New feedback',
      message: `${authorName} added feedback on ${path_}${text ? `: ${text}` : '.'}`,
    };
    void prisma.subscriber
      .findMany({ where: { projectId: pid }, select: { email: true } })
      .then((subs) => {
        const externalEmails = subs.map((subscriber) => subscriber.email);
        void sendSubscriberEmails({
          projectName: project.name,
          path: path_,
          commentText: text,
          subscriberEmails: externalEmails,
        });
        void sendProjectMemberNotification({
          ...memberNotification,
          ...(externalEmails.length > 0 ? { excludeEmails: externalEmails } : {}),
        });
      })
      .catch((err) => {
        console.error('[email] subscriber lookup error:', err);
        void sendProjectMemberNotification(memberNotification);
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
