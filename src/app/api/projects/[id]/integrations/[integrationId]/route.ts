// /api/projects/[id]/integrations/[integrationId]
//
// DELETE — remove a single integration. Idempotent: returns
// 200 with { deleted: true, count: 1 } on success and
// { deleted: true, count: 0 } when the id doesn't exist (or
// doesn't belong to the project).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateProjectId } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/teams';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id: projectId, integrationId } = await params;
    const idRes = validateProjectId(projectId);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Scoped delete: we filter on BOTH projectId and id so a
    // malicious operator can't delete an integration belonging
    // to a different project by guessing its id. The
    // dashboard sends both fields, so the scoped check is
    // transparent to the UI.
    const { count } = await prisma.integration.deleteMany({
      where: { id: integrationId, projectId },
    });

    if (count > 0) {
      audit({
        actor: projectId,
        action: 'integration.remove',
        target: projectId,
        metadata: { integrationId },
      });
    }

    // Always 200, even on a 0-count. Idempotent — the dashboard
    // can safely call this from an "X already removed" UI
    // without a 404 vs 200 fork.
    return NextResponse.json({ deleted: true, count });
  } catch (error) {
    console.error('Integration delete error:', error);
    return NextResponse.json({ error: 'Failed to remove integration' }, { status: 500 });
  }
}
