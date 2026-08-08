import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { assertTeamRole } from '@/lib/teams';
import { validateUuidParam } from '@/lib/validation';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string; invitationId: string }> },
) {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;

  const { id, teamId, invitationId } = await params;
  const workspace = validateUuidParam(id, 'id');
  if (!workspace.ok) return NextResponse.json({ error: workspace.error }, { status: 400 });
  const team = validateUuidParam(teamId, 'teamId');
  if (!team.ok) return NextResponse.json({ error: team.error }, { status: 400 });
  const invitation = validateUuidParam(invitationId, 'invitationId');
  if (!invitation.ok) return NextResponse.json({ error: invitation.error }, { status: 400 });

  const access = await assertTeamRole(workspace.value, team.value, ['owner']);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const result = await prisma.teamInvitation.updateMany({
    where: {
      id: invitation.value,
      teamId: team.value,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) {
    return NextResponse.json({ error: 'Pending invitation not found' }, { status: 404 });
  }
  audit({
    actor: access.caller.id,
    action: 'team_invitation.revoke',
    target: invitation.value,
    metadata: { teamId: team.value },
  });
  return NextResponse.json({ revoked: true, id: invitation.value });
}
