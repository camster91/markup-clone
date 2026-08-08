import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId, validateUuidParam } from '@/lib/validation';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;

  try {
    const { id: projectId, deliveryId } = await params;
    const projectIdResult = validateProjectId(projectId);
    if (!projectIdResult.ok) {
      return NextResponse.json({ error: projectIdResult.error }, { status: 400 });
    }
    const deliveryIdResult = validateUuidParam(deliveryId, 'deliveryId');
    if (!deliveryIdResult.ok) {
      return NextResponse.json({ error: deliveryIdResult.error }, { status: 400 });
    }
    const access = await assertProjectAdmin(projectId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const { count } = await prisma.integrationDelivery.updateMany({
      where: {
        id: deliveryId,
        status: 'DEAD_LETTER',
        integration: { projectId },
      },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        retryCycle: { increment: 1 },
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        deliveredAt: null,
        lastStatusCode: null,
        lastError: null,
        externalId: null,
        externalUrl: null,
      },
    });
    if (count !== 1) {
      return NextResponse.json(
        { error: 'Delivery is not available for retry' },
        { status: 409 },
      );
    }
    audit({
      actor: projectId,
      action: 'integration.delivery.retry',
      target: projectId,
      metadata: { deliveryId },
    });
    return NextResponse.json({ queued: true });
  } catch (error) {
    console.error('Integration delivery retry error:', error);
    return NextResponse.json({ error: 'Failed to retry integration delivery' }, { status: 500 });
  }
}
