import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAccessible } from '@/lib/teams';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { emit } from '@/lib/events';
import { sendSubscriberEmails } from '@/lib/email';
import { sendProjectMemberNotification } from '@/lib/project-notification-delivery';
import {
  LIMITS,
  sanitizeText,
  validatePercent,
  validatePinText,
  validateProjectId,
  validateScreenshotId,
} from '@/lib/validation';

type RouteContext = { params: Promise<{ id: string; screenshotId: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;

  const { id, screenshotId } = await params;
  const projectIdResult = validateProjectId(id);
  if (!projectIdResult.ok) return NextResponse.json({ error: projectIdResult.error }, { status: 400 });
  const screenshotIdResult = validateScreenshotId(screenshotId);
  if (!screenshotIdResult.ok) return NextResponse.json({ error: screenshotIdResult.error }, { status: 400 });

  const rate = consume(`dashboard-pin-create:origin:${req.headers.get('origin') ?? 'unknown'}:${projectIdResult.value}`, {
    maxTokens: 30,
    refillRate: 0.1,
  });
  if (!rate.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } });
  }

  const access = await assertProjectAccessible(projectIdResult.value);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  let body: { xPercent?: unknown; yPercent?: unknown; text?: unknown; authorName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const xResult = validatePercent(typeof body.xPercent === 'number' ? body.xPercent : Number.NaN, 'xPercent');
  if (!xResult.ok) return NextResponse.json({ error: xResult.error }, { status: 400 });
  const yResult = validatePercent(typeof body.yPercent === 'number' ? body.yPercent : Number.NaN, 'yPercent');
  if (!yResult.ok) return NextResponse.json({ error: yResult.error }, { status: 400 });
  const textResult = validatePinText(body.text);
  if (!textResult.ok) return NextResponse.json({ error: textResult.error }, { status: 400 });
  const authorResult = sanitizeText(
    typeof body.authorName === 'string' ? body.authorName : access.caller.email,
    LIMITS.AUTHOR_NAME_MAX,
    'authorName',
  );
  if (!authorResult.ok) return NextResponse.json({ error: authorResult.error }, { status: 400 });

  try {
    const screenshot = await prisma.screenshot.findFirst({
      where: { id: screenshotIdResult.value, page: { projectId: projectIdResult.value } },
      select: {
        id: true,
        page: { select: { path: true } },
      },
    });
    if (!screenshot) return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 });
    const project = await prisma.project.findUnique({
      where: { id: projectIdResult.value },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        activeReviewRoundId: true,
        activeReviewRound: { select: { commentsPaused: true } },
      },
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (project.archivedAt) return NextResponse.json({ error: 'This site is archived and is not accepting new feedback' }, { status: 409 });
    if (project.activeReviewRound?.commentsPaused) {
      return NextResponse.json({ error: 'New feedback is paused for this review round' }, { status: 409 });
    }

    const pin = await prisma.pin.create({
      data: {
        screenshotId: screenshot.id,
        reviewRoundId: project.activeReviewRoundId || undefined,
        xPercent: xResult.value,
        yPercent: yResult.value,
        authorName: authorResult.value,
        comments: {
          create: { text: textResult.value, author: authorResult.value, authorRole: 'reviewer' },
        },
      },
      include: { comments: true },
    });

    const result = {
      id: pin.id,
      xPercent: pin.xPercent,
      yPercent: pin.yPercent,
      status: pin.status,
      priority: pin.priority,
      assignee: null,
      tags: [],
      elementXPath: null,
      elementHTML: null,
      developerContext: null,
      createdAt: pin.createdAt.toISOString(),
      comments: pin.comments.map((comment) => ({
        id: comment.id,
        text: comment.text,
        author: comment.author,
        authorRole: comment.authorRole,
        createdAt: comment.createdAt.toISOString(),
        attachments: [],
      })),
      annotations: [],
    };
    audit({
      actor: access.caller.email,
      action: 'pin.create',
      target: pin.id,
      metadata: { projectId: project.id, screenshotId: screenshot.id, source: 'dashboard' },
    });
    emit({
      type: 'new-pin',
      projectId: project.id,
      payload: {
        pin: {
          id: pin.id,
          screenshotId: screenshot.id,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          status: pin.status,
          authorName: pin.authorName,
          createdAt: pin.createdAt.toISOString(),
        },
      },
    });

    const notification = {
      projectId: project.id,
      pinId: pin.id,
      event: 'new-pin' as const,
      title: 'New feedback',
      message: `${authorResult.value} added feedback on ${screenshot.page.path}: ${textResult.value}`,
    };
    void prisma.subscriber.findMany({ where: { projectId: project.id }, select: { email: true } })
      .then((subscribers) => {
        const externalEmails = subscribers.map(({ email }) => email);
        void sendSubscriberEmails({
          projectName: project.name,
          path: screenshot.page.path,
          commentText: textResult.value,
          subscriberEmails: externalEmails,
        });
        void sendProjectMemberNotification({
          ...notification,
          ...(externalEmails.length ? { excludeEmails: externalEmails } : {}),
        });
      })
      .catch((error) => console.error('[email] dashboard pin notification error:', error));

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('Dashboard pin create error:', error);
    return NextResponse.json({ error: 'Failed to create pin' }, { status: 500 });
  }
}
