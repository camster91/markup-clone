import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateSubscriberEmail, validateProjectId } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/teams';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; email: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id: projectId, email } = await params;
    const idRes = validateProjectId(projectId);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Normalize the email the same way the POST /subscribers route does
    // (R0.3 wired validateSubscriberEmail there, which lowercases on the
    // way in). Without this, a dashboard DELETE for `Alice@Example.com`
    // would not match the row that was stored as `alice@example.com` —
    // the operator would see { deleted: true, count: 0 } and the
    // subscriber would keep getting emails. Reject obviously-bad input
    // with a 400; the lowercased form is what we use in the WHERE
    // clause and the audit log.
    const emailRes = validateSubscriberEmail(email);
    if (!emailRes.ok) {
      return NextResponse.json({ error: emailRes.error }, { status: 400 });
    }
    const emailNormalized = emailRes.value;
    // deleteMany is idempotent: it returns { count: 0 } if no row matched.
    // The response shape stays { deleted: true } either way so the client
    // can treat the call as fire-and-forget. Tests verify both paths.
    const { count } = await prisma.subscriber.deleteMany({
      where: { projectId, email: emailNormalized },
    });
    audit({
      actor: projectId,
      action: 'subscriber.remove',
      target: projectId,
      metadata: { email: emailNormalized, requested: email, count },
    });
    return NextResponse.json({ deleted: true, count });
  } catch (error) {
    console.error('Subscriber delete error:', error);
    return NextResponse.json({ error: 'Failed to remove subscriber' }, { status: 500 });
  }
}
