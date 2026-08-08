import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { parseHost } from '@/lib/origin';
import { assertTeamRole } from '@/lib/teams';
import {
  validateTeamMemberEmail,
  validateTeamRole,
  validateUuidParam,
} from '@/lib/validation';
import {
  buildInvitationUrl,
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
} from '@/lib/team-invitations';

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  project: { id: string; name: string } | null;
};

function publicInvitation(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    project: row.project,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

async function authorize(req: Request, id: string, teamId: string) {
  const authError = await requireDashboardAuth(req);
  if (authError) return { response: authError } as const;
  const workspace = validateUuidParam(id, 'id');
  if (!workspace.ok) {
    return { response: NextResponse.json({ error: workspace.error }, { status: 400 }) } as const;
  }
  const team = validateUuidParam(teamId, 'teamId');
  if (!team.ok) {
    return { response: NextResponse.json({ error: team.error }, { status: 400 }) } as const;
  }
  const access = await assertTeamRole(workspace.value, team.value, ['owner']);
  if (!access.ok) {
    return { response: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  }
  return { workspaceId: workspace.value, teamId: team.value, access } as const;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const { id, teamId } = await params;
  const authorization = await authorize(req, id, teamId);
  if ('response' in authorization) return authorization.response;

  const rows = await prisma.teamInvitation.findMany({
    where: { teamId: authorization.teamId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(rows.map(publicInvitation), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;
  const { id, teamId } = await params;
  const authorization = await authorize(req, id, teamId);
  if ('response' in authorization) return authorization.response;

  let body: { email?: unknown; role?: unknown; projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const email = validateTeamMemberEmail(body.email);
  if (!email.ok) return NextResponse.json({ error: email.error }, { status: 400 });
  const role = validateTeamRole(body.role);
  if (!role.ok) return NextResponse.json({ error: role.error }, { status: 400 });

  let project: { id: string; name: string } | null = null;
  if (role.value === 'guest') {
    const projectId = validateUuidParam(body.projectId, 'projectId');
    if (!projectId.ok) return NextResponse.json({ error: projectId.error }, { status: 400 });
    project = await prisma.project.findFirst({
      where: { id: projectId.value, teamId: authorization.teamId },
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json({ error: 'Guest project must belong to this team' }, { status: 400 });
    }
  } else if (body.projectId !== undefined && body.projectId !== null) {
    return NextResponse.json({ error: 'Only guest invitations may select a project' }, { status: 400 });
  }

  const team = await prisma.team.findFirst({
    where: { id: authorization.teamId, workspaceId: authorization.workspaceId },
    select: { id: true, name: true, workspace: { select: { id: true, name: true } } },
  });
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const activeMember = await prisma.teamMember.findFirst({
    where: { teamId: authorization.teamId, email: email.value, userId: { not: null } },
    select: { id: true },
  });
  if (activeMember) {
    return NextResponse.json({ error: 'This email is already an active member' }, { status: 409 });
  }

  const token = generateInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.teamInvitation.updateMany({
      where: {
        teamId: authorization.teamId,
        email: email.value,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    return tx.teamInvitation.create({
      data: {
        teamId: authorization.teamId,
        email: email.value,
        role: role.value,
        projectId: project?.id ?? null,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedByUserId: authorization.access.caller.id,
      },
      include: { project: { select: { id: true, name: true } } },
    });
  });

  audit({
    actor: authorization.access.caller.id,
    action: 'team_invitation.create',
    target: invitation.id,
    metadata: {
      teamId: authorization.teamId,
      email: invitation.email,
      role: invitation.role,
      projectId: invitation.project?.id ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });

  const origin = parseHost(process.env.DASHBOARD_HOST).origin;
  return NextResponse.json(
    {
      invitation: publicInvitation(invitation),
      acceptUrl: buildInvitationUrl(origin, token),
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
