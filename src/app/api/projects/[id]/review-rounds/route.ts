import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertProjectAccessible, assertProjectAdmin } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';
import { sanitizeReviewRoundName, serializeReviewRound } from '@/lib/review-workflow';
import { DEFAULT_REVIEW_ROUND_TEMPLATE, expandReviewRoundTemplate } from '@/lib/review-defaults';

const reviewDefaultSelect = {
  activeReviewRoundId: true,
  team: { select: { reviewRoundNameTemplate: true, reviewRoundCommentsPaused: true } },
} as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });
    const access = await assertProjectAccessible(idRes.value);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const [project, rounds] = await Promise.all([
      prisma.project.findUnique({ where: { id: idRes.value }, select: reviewDefaultSelect }),
      prisma.reviewRound.findMany({
        where: { projectId: idRes.value },
        orderBy: { number: 'desc' },
        include: {
          _count: { select: { pins: true } },
          signOffs: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, userId: true, signerEmail: true, note: true, createdAt: true },
          },
        },
      }),
    ]);
    const activeReviewRoundId = project?.activeReviewRoundId ?? null;
    const canAdmin = access.membershipRole === 'owner' || access.membershipRole === 'operator';
    const nextNumber = Math.max(0, ...rounds.map((round) => round.number)) + 1;
    const template = project?.team?.reviewRoundNameTemplate ?? DEFAULT_REVIEW_ROUND_TEMPLATE;
    return NextResponse.json({
      activeReviewRoundId,
      canAdmin,
      callerUserId: access.caller.id,
      ...(canAdmin ? {
        defaults: {
          suggestedName: expandReviewRoundTemplate(template, nextNumber),
          commentsPaused: project?.team?.reviewRoundCommentsPaused ?? false,
        },
      } : {}),
      rounds: rounds.map((round) => serializeReviewRound(round, activeReviewRoundId)),
    });
  } catch (error) {
    console.error('Review round list error:', error);
    return NextResponse.json({ error: 'Failed to load review rounds' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });
    const access = await assertProjectAdmin(idRes.value);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = await req.json();
    const nameRes = sanitizeReviewRoundName((body as { name?: unknown }).name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });
    const project = await prisma.project.findUnique({ where: { id: idRes.value }, select: reviewDefaultSelect });
    const defaults = project?.team ?? {
      reviewRoundNameTemplate: DEFAULT_REVIEW_ROUND_TEMPLATE,
      reviewRoundCommentsPaused: false,
    };

    const round = await prisma.$transaction(async (tx) => {
      const latest = await tx.reviewRound.aggregate({
        where: { projectId: idRes.value },
        _max: { number: true },
      });
      const created = await tx.reviewRound.create({
        data: {
          projectId: idRes.value,
          number: (latest._max.number ?? 0) + 1,
          name: nameRes.value ?? expandReviewRoundTemplate(
            defaults.reviewRoundNameTemplate,
            (latest._max.number ?? 0) + 1,
          ),
          commentsPaused: defaults.reviewRoundCommentsPaused,
          createdBy: access.caller.id,
        },
      });
      await tx.project.update({
        where: { id: idRes.value },
        data: { activeReviewRoundId: created.id },
      });
      return created;
    });

    audit({
      actor: access.caller.id,
      action: 'review_round.create',
      target: round.id,
      metadata: { projectId: idRes.value, number: round.number },
    });
    return NextResponse.json(serializeReviewRound(round, round.id), { status: 201 });
  } catch (error) {
    console.error('Review round create error:', error);
    return NextResponse.json({ error: 'Failed to create review round' }, { status: 500 });
  }
}
