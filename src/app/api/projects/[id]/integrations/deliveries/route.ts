import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';

function safeExternalReference(kind: string, id: string | null, rawUrl: string | null) {
  if (kind !== 'github' || !id || !/^\d{1,20}$/.test(id) || !rawUrl) {
    return { externalId: null, externalUrl: null };
  }
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/');
    if (
      url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      url.username || url.password || url.search || url.hash ||
      parts.length !== 5 || parts[3] !== 'issues' || parts[4] !== id ||
      !parts[1] || !parts[2]
    ) return { externalId: null, externalUrl: null };
    return { externalId: id, externalUrl: url.toString() };
  } catch {
    return { externalId: null, externalUrl: null };
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;

  try {
    const { id: projectId } = await params;
    const idResult = validateProjectId(projectId);
    if (!idResult.ok) return NextResponse.json({ error: idResult.error }, { status: 400 });
    const access = await assertProjectAdmin(projectId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const deliveries = await prisma.integrationDelivery.findMany({
      where: { integration: { projectId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        attemptCount: true,
        retryCycle: true,
        nextAttemptAt: true,
        deliveredAt: true,
        lastStatusCode: true,
        lastError: true,
        externalId: true,
        externalUrl: true,
        createdAt: true,
        updatedAt: true,
        integration: { select: { id: true, kind: true } },
        event: { select: { id: true, type: true, occurredAt: true } },
      },
    });
    return NextResponse.json(deliveries.map((delivery) => ({
      ...delivery,
      ...safeExternalReference(
        delivery.integration.kind,
        delivery.externalId,
        delivery.externalUrl,
      ),
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      event: {
        ...delivery.event,
        occurredAt: delivery.event.occurredAt.toISOString(),
      },
    })), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Integration delivery list error:', error);
    return NextResponse.json({ error: 'Failed to list integration deliveries' }, { status: 500 });
  }
}
