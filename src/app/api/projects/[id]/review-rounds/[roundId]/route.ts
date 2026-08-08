import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId, validateUuidParam } from '@/lib/validation';
import {
  canTransitionReviewStatus,
  parseReviewStatus,
  sanitizeReviewRoundName,
  serializeReviewRound,
} from '@/lib/review-workflow';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id, roundId } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });
    const roundIdRes = validateUuidParam(roundId, 'roundId');
    if (!roundIdRes.ok) return NextResponse.json({ error: roundIdRes.error }, { status: 400 });
    const access = await assertProjectAdmin(idRes.value);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const existing = await prisma.reviewRound.findFirst({
      where: { id: roundIdRes.value, projectId: idRes.value },
    });
    if (!existing) return NextResponse.json({ error: 'Review round not found' }, { status: 404 });
    const project = await prisma.project.findUnique({
      where: { id: idRes.value },
      select: { activeReviewRoundId: true },
    });
    if (project?.activeReviewRoundId !== existing.id) {
      return NextResponse.json({ error: 'Historical review rounds cannot be changed' }, { status: 409 });
    }
    const body = await req.json() as { name?: unknown; status?: unknown; commentsPaused?: unknown };
    const data: { name?: string | null; status?: string; commentsPaused?: boolean } = {};

    if (body.name !== undefined) {
      const nameRes = sanitizeReviewRoundName(body.name);
      if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });
      data.name = nameRes.value;
    }
    if (body.status !== undefined) {
      const status = parseReviewStatus(body.status);
      if (!status) return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
      const current = parseReviewStatus(existing.status);
      if (!current || !canTransitionReviewStatus(current, status)) {
        return NextResponse.json({ error: `Cannot transition review from ${existing.status} to ${status}` }, { status: 409 });
      }
      data.status = status;
    }
    if (body.commentsPaused !== undefined) {
      if (typeof body.commentsPaused !== 'boolean') {
        return NextResponse.json({ error: 'commentsPaused must be a boolean' }, { status: 400 });
      }
      data.commentsPaused = body.commentsPaused;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'name, status, or commentsPaused required' }, { status: 400 });
    }

    const round = await prisma.reviewRound.update({ where: { id: roundIdRes.value }, data });
    let activeReviewRoundId: string | null = project?.activeReviewRoundId ?? null;
    if (data.status === 'ARCHIVED' && activeReviewRoundId === round.id) {
      await prisma.project.update({ where: { id: idRes.value }, data: { activeReviewRoundId: null } });
      activeReviewRoundId = null;
    }
    audit({ actor: access.caller.id, action: 'review_round.update', target: round.id, metadata: { projectId: idRes.value, changes: data } });
    return NextResponse.json(serializeReviewRound(round, activeReviewRoundId));
  } catch (error) {
    console.error('Review round update error:', error);
    return NextResponse.json({ error: 'Failed to update review round' }, { status: 500 });
  }
}
