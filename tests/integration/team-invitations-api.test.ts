import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashInvitationToken } from '@/lib/team-invitations';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const INVITATION_ID = '44444444-4444-4444-8444-444444444444';
const CSRF = 'invitation-csrf-token';

const mocks = vi.hoisted(() => ({
  team: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  teamMember: { findFirst: vi.fn() },
  teamInvitation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const access = vi.hoisted(() => ({ assertTeamRole: vi.fn() }));
const auditMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => access);
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import {
  GET as listInvitations,
  POST as createInvitation,
} from '@/app/api/workspaces/[id]/teams/[teamId]/invitations/route';
import { DELETE as revokeInvitation } from '@/app/api/workspaces/[id]/teams/[teamId]/invitations/[invitationId]/route';

const params = { params: Promise.resolve({ id: WORKSPACE_ID, teamId: TEAM_ID }) };
const invitationParams = {
  params: Promise.resolve({ id: WORKSPACE_ID, teamId: TEAM_ID, invitationId: INVITATION_ID }),
};

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest(
    `https://markup.ashbi.ca/api/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}/invitations`,
    {
      method,
      headers: {
        Origin: 'https://markup.ashbi.ca',
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF,
        cookie: `markup.csrf=${CSRF}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  access.assertTeamRole.mockResolvedValue({
    ok: true,
    caller: { id: 'owner-1', email: 'owner@example.com', role: 'reviewer' },
    membershipRole: 'owner',
    teamId: TEAM_ID,
    workspaceId: WORKSPACE_ID,
  });
  mocks.team.findFirst.mockResolvedValue({
    id: TEAM_ID,
    name: 'Client Delivery',
    workspace: { id: WORKSPACE_ID, name: 'Agency' },
  });
  mocks.project.findFirst.mockResolvedValue({ id: PROJECT_ID, name: 'Client Site' });
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamInvitation.findMany.mockResolvedValue([]);
  mocks.teamInvitation.updateMany.mockResolvedValue({ count: 1 });
  mocks.teamInvitation.create.mockImplementation(async ({ data }) => ({
    id: INVITATION_ID,
    ...data,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-08T06:00:00.000Z'),
    updatedAt: new Date('2026-08-08T06:00:00.000Z'),
    project: data.projectId ? { id: data.projectId, name: 'Client Site' } : null,
  }));
  mocks.$transaction.mockImplementation(async (callback) => callback(mocks));
});

describe('team invitation owner API', () => {
  it('creates a hash-only guest invitation and returns its fragment URL once', async () => {
    const response = await createInvitation(
      request('POST', { email: 'Guest@Example.com', role: 'guest', projectId: PROJECT_ID }),
      params,
    );
    expect(response!.status).toBe(201);
    const body = await response!.json();
    expect(body.acceptUrl).toMatch(/^https:\/\/markup\.ashbi\.ca\/invite#[A-Za-z0-9_-]{43}$/);
    expect(body.invitation).toMatchObject({
      id: INVITATION_ID,
      email: 'guest@example.com',
      role: 'guest',
      project: { id: PROJECT_ID, name: 'Client Site' },
    });
    expect(JSON.stringify(body)).not.toContain('tokenHash');

    const token = body.acceptUrl.split('#')[1];
    const createData = mocks.teamInvitation.create.mock.calls[0][0].data;
    expect(createData.tokenHash).toBe(hashInvitationToken(token));
    expect(createData.tokenHash).not.toBe(token);
    expect(createData.invitedByUserId).toBe('owner-1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'owner-1',
      action: 'team_invitation.create',
      metadata: expect.not.objectContaining({ token, tokenHash: createData.tokenHash }),
    }));
  });

  it('requires a same-team project for a guest and forbids it for other roles', async () => {
    mocks.project.findFirst.mockResolvedValueOnce(null);
    const missing = await createInvitation(
      request('POST', { email: 'guest@example.com', role: 'guest', projectId: PROJECT_ID }),
      params,
    );
    expect(missing!.status).toBe(400);

    const extra = await createInvitation(
      request('POST', { email: 'client@example.com', role: 'client', projectId: PROJECT_ID }),
      params,
    );
    expect(extra!.status).toBe(400);
    expect(mocks.teamInvitation.create).not.toHaveBeenCalled();
  });

  it('lists safe invitation state without token hashes', async () => {
    mocks.teamInvitation.findMany.mockResolvedValue([{
      id: INVITATION_ID,
      email: 'client@example.com',
      role: 'client',
      expiresAt: new Date('2026-08-15T06:00:00.000Z'),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date('2026-08-08T06:00:00.000Z'),
      project: null,
      tokenHash: 'f'.repeat(64),
    }]);
    const response = await listInvitations(request('GET'), params);
    expect(response!.status).toBe(200);
    const text = await response!.text();
    expect(text).toContain('client@example.com');
    expect(text).not.toContain('tokenHash');
    expect(text).not.toContain('f'.repeat(64));
  });

  it('revokes only a pending invitation in the nested team', async () => {
    const response = await revokeInvitation(request('DELETE'), invitationParams);
    expect(response.status).toBe(200);
    expect(mocks.teamInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        teamId: TEAM_ID,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'owner-1',
      action: 'team_invitation.revoke',
      target: INVITATION_ID,
    }));
  });
});
