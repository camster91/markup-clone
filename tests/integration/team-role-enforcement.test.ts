import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const CSRF_TOKEN = 'team-role-csrf-token';

const mocks = vi.hoisted(() => ({
  team: {
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  teamMember: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  project: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}));

const accessMocks = vi.hoisted(() => ({
  assertTeamRole: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => accessMocks);
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import {
  GET as listMembers,
  POST as inviteMember,
} from '@/app/api/workspaces/[id]/teams/[teamId]/members/route';
import {
  PATCH as updateMember,
  DELETE as removeMember,
} from '@/app/api/workspaces/[id]/teams/[teamId]/members/[memberId]/route';
import {
  PATCH as updateTeam,
  DELETE as removeTeam,
} from '@/app/api/workspaces/[id]/teams/[teamId]/route';

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest(
    `https://markup.ashbi.ca/api/workspaces/${WORKSPACE_ID}/teams/${TEAM_ID}`,
    {
      method,
      headers: {
        Origin: 'https://markup.ashbi.ca',
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN,
        cookie: `markup.csrf=${CSRF_TOKEN}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

const teamParams = {
  params: Promise.resolve({ id: WORKSPACE_ID, teamId: TEAM_ID }),
};
const memberParams = {
  params: Promise.resolve({
    id: WORKSPACE_ID,
    teamId: TEAM_ID,
    memberId: MEMBER_ID,
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  accessMocks.assertTeamRole.mockResolvedValue({
    ok: false,
    status: 403,
    error: 'Owner role required',
  });
  mocks.team.findFirst.mockResolvedValue({
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Client Delivery',
    _count: { projects: 0, members: 1 },
  });
  mocks.team.update.mockResolvedValue({
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Renamed Team',
  });
  mocks.team.delete.mockResolvedValue({ id: TEAM_ID });
  mocks.teamMember.findFirst.mockResolvedValue({
    id: MEMBER_ID,
    teamId: TEAM_ID,
    userId: '44444444-4444-4444-8444-444444444444',
    email: 'owner@example.com',
    role: 'owner',
  });
  mocks.teamMember.findMany.mockResolvedValue([]);
  mocks.teamMember.count.mockResolvedValue(1);
  mocks.project.findFirst.mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555' });
  mocks.teamMember.create.mockResolvedValue({
    id: MEMBER_ID,
    teamId: TEAM_ID,
    userId: null,
    email: 'new@example.com',
    role: 'reviewer',
  });
  mocks.teamMember.update.mockResolvedValue({
    id: MEMBER_ID,
    teamId: TEAM_ID,
    email: 'owner@example.com',
    role: 'reviewer',
  });
  mocks.teamMember.delete.mockResolvedValue({ id: MEMBER_ID });
});

describe('owner-only team administration', () => {
  it('blocks a non-member from listing team members', async () => {
    const response = await listMembers(request('GET'), teamParams);
    expect(response.status).toBe(403);
    expect(mocks.teamMember.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from inviting a member', async () => {
    const response = await inviteMember(
      request('POST', { email: 'new@example.com', role: 'reviewer' }),
      teamParams
    );
    expect(response.status).toBe(403);
    expect(mocks.teamMember.create).not.toHaveBeenCalled();
  });

  it('keeps the member directory owner-only', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: false, status: 403, error: 'Required team role missing',
    });
    const response = await listMembers(request('GET'), teamParams);
    expect(response.status).toBe(403);
    expect(mocks.teamMember.findMany).not.toHaveBeenCalled();
  });

  it('requires the managed invitation endpoint instead of direct member creation', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: true,
      caller: { id: 'owner-user', email: 'owner@example.com', role: 'reviewer' },
      membershipRole: 'owner',
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    const response = await inviteMember(
      request('POST', { email: 'new@example.com', role: 'client' }),
      teamParams,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Use the managed invitation endpoint to add members',
    });
    expect(mocks.teamMember.create).not.toHaveBeenCalled();
  });

  it('does not demote or remove the last claimed owner', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: true,
      caller: { id: 'owner-user', email: 'owner@example.com', role: 'reviewer' },
      membershipRole: 'owner',
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    mocks.teamMember.findFirst.mockResolvedValue({
      id: MEMBER_ID,
      teamId: TEAM_ID,
      userId: 'owner-user',
      email: 'owner@example.com',
      role: 'owner',
      projectId: null,
    });
    mocks.teamMember.count.mockResolvedValue(1);

    const demote = await updateMember(request('PATCH', { role: 'client' }), memberParams);
    expect(demote.status).toBe(409);
    const remove = await removeMember(request('DELETE'), memberParams);
    expect(remove.status).toBe(409);
    expect(mocks.teamMember.update).not.toHaveBeenCalled();
    expect(mocks.teamMember.delete).not.toHaveBeenCalled();
  });

  it('requires a same-team project when changing a member to guest', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: true,
      caller: { id: 'owner-user', email: 'owner@example.com', role: 'reviewer' },
      membershipRole: 'owner',
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    mocks.teamMember.findFirst.mockResolvedValue({
      id: MEMBER_ID, teamId: TEAM_ID, userId: 'client-user', email: 'client@example.com',
      role: 'client', projectId: null,
    });
    mocks.project.findFirst.mockResolvedValue(null);
    const response = await updateMember(
      request('PATCH', { role: 'guest', projectId: '55555555-5555-4555-8555-555555555555' }),
      memberParams,
    );
    expect(response.status).toBe(400);
    expect(mocks.teamMember.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from changing a member role', async () => {
    const response = await updateMember(
      request('PATCH', { role: 'reviewer' }),
      memberParams
    );
    expect(response.status).toBe(403);
    expect(mocks.teamMember.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from removing a member', async () => {
    const response = await removeMember(request('DELETE'), memberParams);
    expect(response.status).toBe(403);
    expect(mocks.teamMember.delete).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from renaming a team', async () => {
    const response = await updateTeam(
      request('PATCH', { name: 'Renamed Team' }),
      teamParams
    );
    expect(response.status).toBe(403);
    expect(mocks.team.update).not.toHaveBeenCalled();
  });

  it('lets an owner save bounded reusable review defaults without renaming the client account', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: true,
      caller: { id: 'owner-user', email: 'owner@example.com', role: 'reviewer' },
      membershipRole: 'owner',
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    mocks.team.update.mockResolvedValue({
      id: TEAM_ID,
      name: 'Client Delivery',
      reviewRoundNameTemplate: 'Sprint {n} review',
      reviewRoundCommentsPaused: true,
    });
    const response = await updateTeam(request('PATCH', {
      reviewRoundNameTemplate: ' Sprint {n} review ',
      reviewRoundCommentsPaused: true,
    }), teamParams);
    expect(response.status).toBe(200);
    expect(mocks.team.update).toHaveBeenCalledWith({
      where: { id: TEAM_ID },
      data: { reviewRoundNameTemplate: 'Sprint {n} review', reviewRoundCommentsPaused: true },
    });
  });

  it('rejects a review template without the numbered placeholder', async () => {
    accessMocks.assertTeamRole.mockResolvedValue({
      ok: true,
      caller: { id: 'owner-user', email: 'owner@example.com', role: 'reviewer' },
      membershipRole: 'owner', teamId: TEAM_ID, workspaceId: WORKSPACE_ID,
    });
    const response = await updateTeam(request('PATCH', {
      reviewRoundNameTemplate: 'Repeated name',
      reviewRoundCommentsPaused: false,
    }), teamParams);
    expect(response.status).toBe(400);
    expect(mocks.team.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from deleting a team', async () => {
    const response = await removeTeam(request('DELETE'), teamParams);
    expect(response.status).toBe(403);
    expect(mocks.team.delete).not.toHaveBeenCalled();
  });
});
