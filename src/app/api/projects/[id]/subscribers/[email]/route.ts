import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; email: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id: projectId, email } = await params;
    // Reject control characters before they reach the DB / audit log.
    // Same rationale as the POST route: the path segment is decoded by
    // Next, so CR/LF could otherwise be a header-injection vector if
    // anything later renders the audit log in an email/Slack context.
    if (/[\r\n]/.test(email)) {
      return NextResponse.json({ error: 'email must not contain control characters' }, { status: 400 });
    }
    // deleteMany is idempotent: it returns { count: 0 } if no row matched.
    // The response shape stays { deleted: true } either way so the client
    // can treat the call as fire-and-forget. Tests verify both paths.
    const { count } = await prisma.subscriber.deleteMany({ where: { projectId, email } });
    audit({
      actor: projectId,
      action: 'subscriber.remove',
      target: projectId,
      metadata: { email, count },
    });
    return NextResponse.json({ deleted: true, count });
  } catch (error) {
    console.error('Subscriber delete error:', error);
    return NextResponse.json({ error: 'Failed to remove subscriber' }, { status: 500 });
  }
}
