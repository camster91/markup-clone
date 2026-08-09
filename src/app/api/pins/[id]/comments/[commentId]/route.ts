import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { assertProjectAdmin } from '@/lib/teams';
import { validatePinId, validatePinText, validateUuidParam } from '@/lib/validation';

type RouteContext = { params: Promise<{ id: string; commentId: string }> };
type RequestIds = { pinId: string; commentId: string };
type RequestValidation = { error: NextResponse } | RequestIds;
type AuthorizedMutation = { error: NextResponse } | (RequestIds & { admin: { caller: { email: string } } });

async function resolveProjectId(pinId: string): Promise<string | null> {
  const pin = await prisma.pin.findUnique({
    where: { id: pinId },
    select: { screenshot: { select: { page: { select: { projectId: true } } } } },
  });
  return pin?.screenshot?.page?.projectId ?? null;
}

async function validateMutationRequest(req: Request, context: RouteContext): Promise<RequestValidation> {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return { error: authErr } as const;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return { error: csrfErr } as const;

  const { id, commentId } = await context.params;
  const pinIdResult = validatePinId(id);
  if (!pinIdResult.ok) return { error: NextResponse.json({ error: pinIdResult.error }, { status: 400 }) } as const;
  const commentIdResult = validateUuidParam(commentId, 'commentId');
  if (!commentIdResult.ok) return { error: NextResponse.json({ error: commentIdResult.error }, { status: 400 }) } as const;

  return { pinId: id, commentId } as const;
}

async function authorizeCommentMutation(req: Request, ids: RequestIds): Promise<AuthorizedMutation> {
  const { pinId, commentId } = ids;

  const rate = consume(`comment-lifecycle:origin:${req.headers.get('origin') ?? 'unknown'}:${pinId}`, {
    maxTokens: 20,
    refillRate: 1 / 3,
  });
  if (!rate.ok) {
    return {
      error: new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }),
    } as const;
  }

  const projectId = await resolveProjectId(pinId);
  if (!projectId) return { error: NextResponse.json({ error: 'Pin not found' }, { status: 404 }) } as const;
  const admin = await assertProjectAdmin(projectId);
  if (!admin.ok) return { error: NextResponse.json({ error: admin.error }, { status: admin.status }) } as const;

  return { pinId, commentId, admin } as const;
}

async function findScopedComment(pinId: string, commentId: string) {
  return prisma.comment.findFirst({
    where: { id: commentId, pinId },
    select: { id: true, pinId: true, text: true, author: true, authorRole: true, createdAt: true },
  });
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const requestIds = await validateMutationRequest(req, context);
  if ('error' in requestIds) return requestIds.error;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'text')) {
    return NextResponse.json({ error: 'body must contain only text' }, { status: 400 });
  }
  const textResult = validatePinText((body as { text?: unknown }).text);
  if (!textResult.ok) return NextResponse.json({ error: textResult.error }, { status: 400 });

  const authorized = await authorizeCommentMutation(req, requestIds);
  if ('error' in authorized) return authorized.error;

  try {
    const comment = await findScopedComment(authorized.pinId, authorized.commentId);
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    const updated = await prisma.comment.update({
      where: { id: authorized.commentId },
      data: { text: textResult.value },
    });
    audit({
      actor: authorized.admin.caller.email,
      action: 'comment.update',
      target: authorized.commentId,
      metadata: { pinId: authorized.pinId },
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Comment update error:', error);
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: RouteContext): Promise<NextResponse> {
  const requestIds = await validateMutationRequest(req, context);
  if ('error' in requestIds) return requestIds.error;
  const authorized = await authorizeCommentMutation(req, requestIds);
  if ('error' in authorized) return authorized.error;

  try {
    const comment = await findScopedComment(authorized.pinId, authorized.commentId);
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    await prisma.comment.delete({ where: { id: authorized.commentId } });
    audit({
      actor: authorized.admin.caller.email,
      action: 'comment.delete',
      target: authorized.commentId,
      metadata: { pinId: authorized.pinId },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Comment delete error:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
