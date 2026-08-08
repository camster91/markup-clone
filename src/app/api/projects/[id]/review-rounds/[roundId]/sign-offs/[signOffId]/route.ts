import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertProjectAccessible, assertProjectAdmin, canSignOffProject } from '@/lib/teams';
import { validateProjectId, validateUuidParam } from '@/lib/validation';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; roundId: string; signOffId: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id, roundId, signOffId } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });
    const roundIdRes = validateUuidParam(roundId, 'roundId');
    if (!roundIdRes.ok) return NextResponse.json({ error: roundIdRes.error }, { status: 400 });
    const signOffIdRes = validateUuidParam(signOffId, 'signOffId');
    if (!signOffIdRes.ok) return NextResponse.json({ error: signOffIdRes.error }, { status: 400 });
    const access = await assertProjectAccessible(idRes.value);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!canSignOffProject(access.membershipRole)) {
      return NextResponse.json({ error: 'Client sign-off role required' }, { status: 403 });
    }
    const signOff = await prisma.reviewSignOff.findFirst({
      where: { id: signOffIdRes.value, reviewRoundId: roundIdRes.value, reviewRound: { projectId: idRes.value } },
      select: { id: true, userId: true },
    });
    if (!signOff) return NextResponse.json({ error: 'Sign-off not found' }, { status: 404 });
    if (signOff.userId !== access.caller.id) {
      const admin = await assertProjectAdmin(idRes.value);
      if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
    }
    await prisma.reviewSignOff.delete({ where: { id: signOff.id } });
    audit({ actor: access.caller.id, action: 'review_sign_off.withdraw', target: signOff.id, metadata: { projectId: idRes.value, reviewRoundId: roundIdRes.value } });
    return NextResponse.json({ deleted: true, id: signOff.id });
  } catch (error) {
    console.error('Review sign-off withdrawal error:', error);
    return NextResponse.json({ error: 'Failed to withdraw sign-off' }, { status: 500 });
  }
}
