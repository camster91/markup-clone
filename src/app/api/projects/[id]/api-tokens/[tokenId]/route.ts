import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAdmin } from '@/lib/teams';
import { audit } from '@/lib/audit';
import { validateProjectId, validateUuidParam } from '@/lib/validation';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tokenId: string }> },
) {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;
  const { id, tokenId } = await params;
  const projectId = validateProjectId(id);
  if (!projectId.ok) return NextResponse.json({ error: projectId.error }, { status: 400 });
  const tokenIdResult = validateUuidParam(tokenId, 'tokenId');
  if (!tokenIdResult.ok) return NextResponse.json({ error: tokenIdResult.error }, { status: 400 });
  const access = await assertProjectAdmin(projectId.value);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const existing = await prisma.projectApiToken.findFirst({
    where: { id: tokenIdResult.value, projectId: projectId.value },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return NextResponse.json({ error: 'Developer token not found' }, { status: 404 });
  const revokedAt = existing.revokedAt ?? new Date();
  await prisma.projectApiToken.update({
    where: { id: existing.id },
    data: { revokedAt },
  });
  audit({
    actor: access.caller.id,
    action: 'developer_api_token.revoke',
    target: existing.id,
    metadata: { projectId: projectId.value },
  });
  return NextResponse.json({ revoked: true, revokedAt });
}
