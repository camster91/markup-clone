import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertProjectAccessible, canSignOffProject } from '@/lib/teams';
import { validateProjectId, validateUuidParam } from '@/lib/validation';
import { sanitizeSignOffNote } from '@/lib/review-workflow';

export async function POST(
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
    const access = await assertProjectAccessible(idRes.value);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!canSignOffProject(access.membershipRole)) {
      return NextResponse.json({ error: 'Client sign-off role required' }, { status: 403 });
    }
    const round = await prisma.reviewRound.findFirst({ where: { id: roundIdRes.value, projectId: idRes.value }, select: { id: true } });
    if (!round) return NextResponse.json({ error: 'Review round not found' }, { status: 404 });
    const project = await prisma.project.findUnique({ where: { id: idRes.value }, select: { activeReviewRoundId: true } });
    if (project?.activeReviewRoundId !== round.id) {
      return NextResponse.json({ error: 'Only the active review round can be signed off' }, { status: 409 });
    }
    const body = await req.json() as { note?: unknown };
    const noteRes = sanitizeSignOffNote(body.note);
    if (!noteRes.ok) return NextResponse.json({ error: noteRes.error }, { status: 400 });

    const signOff = await prisma.reviewSignOff.upsert({
      where: { reviewRoundId_userId: { reviewRoundId: round.id, userId: access.caller.id } },
      update: { note: noteRes.value, signerEmail: access.caller.email },
      create: { reviewRoundId: round.id, userId: access.caller.id, signerEmail: access.caller.email, note: noteRes.value },
      select: { id: true, userId: true, signerEmail: true, note: true, createdAt: true },
    });
    audit({ actor: access.caller.id, action: 'review_sign_off.create', target: signOff.id, metadata: { projectId: idRes.value, reviewRoundId: round.id } });
    return NextResponse.json(signOff);
  } catch (error) {
    console.error('Review sign-off error:', error);
    return NextResponse.json({ error: 'Failed to save sign-off' }, { status: 500 });
  }
}
