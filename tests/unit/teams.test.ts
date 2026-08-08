import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  team: { findFirst: vi.fn() },
  teamMember: { findFirst: vi.fn(), findMany: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => authState.user),
}));

import {
  assertProjectAdmin,
  assertProjectAccessible,
  assertOperator,
  assertTeamRole,
  canSignOffProject,
  getCallerAdminTeamIds,
  getProjectScopeWhere,
  getWorkspaceScopeWhere,
} from '@/lib/teams';

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = null;
  mocks.project.findUnique.mockResolvedValue({ id: 'project-1', teamId: null });
  mocks.team.findFirst.mockResolvedValue({ id: 'team-1', workspaceId: 'workspace-1' });
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamMember.findMany.mockResolvedValue([]);
});

describe('team project access boundaries', () => {
  it('returns an empty project scope for an anonymous caller', async () => {
    await expect(getProjectScopeWhere(null)).resolves.toEqual({ id: { in: [] } });
    expect(mocks.teamMember.findMany).not.toHaveBeenCalled();
  });

  it('does not scope a global operator project query', async () => {
    await expect(
      getProjectScopeWhere({
        id: 'operator-1',
        email: 'operator@example.com',
        role: 'operator',
      })
    ).resolves.toEqual({});
    expect(mocks.teamMember.findMany).not.toHaveBeenCalled();
  });

  it('rejects anonymous access to a legacy unscoped project', async () => {
    await expect(assertProjectAccessible('project-1')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Authentication required',
    });
    expect(mocks.teamMember.findFirst).not.toHaveBeenCalled();
  });

  it('allows an authenticated caller to access a legacy unscoped project', async () => {
    authState.user = {
      id: 'user-1',
      email: 'operator@example.com',
      role: 'operator',
    };

    await expect(assertProjectAccessible('project-1')).resolves.toMatchObject({
      ok: true,
      projectId: 'project-1',
      teamId: null,
      membershipRole: 'operator',
    });
  });

  it('allows a global operator to access a team-scoped project', async () => {
    authState.user = {
      id: 'operator-1',
      email: 'operator@example.com',
      role: 'operator',
    };
    mocks.project.findUnique.mockResolvedValue({ id: 'project-1', teamId: 'team-1' });

    await expect(assertProjectAccessible('project-1')).resolves.toMatchObject({
      ok: true,
      projectId: 'project-1',
      teamId: 'team-1',
      membershipRole: 'operator',
    });
    expect(mocks.teamMember.findFirst).not.toHaveBeenCalled();
  });

  it('scopes a guest to only the explicitly granted project', async () => {
    mocks.teamMember.findMany.mockResolvedValue([
      { teamId: 'team-1', role: 'guest', projectId: 'project-guest' },
    ]);

    await expect(
      getProjectScopeWhere({ id: 'guest-1', email: 'guest@example.com', role: 'reviewer' })
    ).resolves.toEqual({ id: { in: ['project-guest'] } });
  });

  it('keeps a contributor team-wide and eligible for project administration', async () => {
    mocks.teamMember.findMany.mockResolvedValue([
      { teamId: 'team-1', role: 'contributor', projectId: null },
    ]);
    await expect(
      getProjectScopeWhere({ id: 'dev-1', email: 'dev@example.com', role: 'reviewer' })
    ).resolves.toEqual({ teamId: { in: ['team-1'] } });

    authState.user = { id: 'dev-1', email: 'dev@example.com', role: 'reviewer' };
    mocks.project.findUnique.mockResolvedValue({ id: 'project-1', teamId: 'team-1' });
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-1', role: 'contributor', projectId: null,
    });
    await expect(assertProjectAdmin('project-1')).resolves.toMatchObject({
      ok: true,
      membershipRole: 'contributor',
    });
  });

  it('rejects a guest whose grant belongs to another project', async () => {
    authState.user = { id: 'guest-1', email: 'guest@example.com', role: 'reviewer' };
    mocks.project.findUnique.mockResolvedValue({ id: 'project-1', teamId: 'team-1' });
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-1', role: 'guest', projectId: 'project-2',
    });

    await expect(assertProjectAccessible('project-1')).resolves.toEqual({
      ok: false,
      status: 403,
      error: "Not a member of this project's team",
    });
  });

  it('returns a guest project grant from team authorization', async () => {
    authState.user = { id: 'guest-1', email: 'guest@example.com', role: 'reviewer' };
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-1', role: 'guest', projectId: 'project-guest',
    });
    await expect(assertTeamRole('workspace-1', 'team-1')).resolves.toMatchObject({
      ok: true,
      membershipRole: 'guest',
      membershipProjectId: 'project-guest',
    });
  });

  it('allows client sign-off but denies guest sign-off', () => {
    expect(canSignOffProject('client')).toBe(true);
    expect(canSignOffProject('owner')).toBe(true);
    expect(canSignOffProject('contributor')).toBe(true);
    expect(canSignOffProject('guest')).toBe(false);
    expect(canSignOffProject('operator')).toBe(true);
  });

  it('returns owner and contributor teams as project-admin scopes', async () => {
    mocks.teamMember.findMany.mockResolvedValue([
      { teamId: 'team-owner' },
      { teamId: 'team-contributor' },
    ]);
    await expect(getCallerAdminTeamIds('user-1')).resolves.toEqual([
      'team-owner',
      'team-contributor',
    ]);
    expect(mocks.teamMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', role: { in: ['owner', 'contributor'] }, projectId: null },
      select: { teamId: true },
    });
  });

  it('rejects a reviewer from an owner-only team operation', async () => {
    authState.user = {
      id: 'reviewer-1',
      email: 'reviewer@example.com',
      role: 'reviewer',
    };
    mocks.teamMember.findFirst.mockResolvedValue({ id: 'member-1', role: 'reviewer' });

    await expect(
      assertTeamRole('workspace-1', 'team-1', ['owner'])
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Owner role required',
    });
  });

  it('allows a team owner to perform an owner-only operation', async () => {
    authState.user = {
      id: 'owner-1',
      email: 'owner@example.com',
      role: 'reviewer',
    };
    mocks.teamMember.findFirst.mockResolvedValue({ id: 'member-1', role: 'owner' });

    await expect(
      assertTeamRole('workspace-1', 'team-1', ['owner'])
    ).resolves.toMatchObject({
      ok: true,
      caller: authState.user,
      membershipRole: 'owner',
    });
  });

  it('allows a global operator without a team membership', async () => {
    authState.user = {
      id: 'operator-1',
      email: 'operator@example.com',
      role: 'operator',
    };

    await expect(
      assertTeamRole('workspace-1', 'team-1', ['owner'])
    ).resolves.toMatchObject({
      ok: true,
      caller: authState.user,
      membershipRole: 'operator',
    });
    expect(mocks.teamMember.findFirst).not.toHaveBeenCalled();
  });

  it('scopes a reviewer to workspaces containing their team membership', () => {
    expect(
      getWorkspaceScopeWhere({
        id: 'reviewer-1',
        email: 'reviewer@example.com',
        role: 'reviewer',
      })
    ).toEqual({
      teams: {
        some: {
          members: { some: { userId: 'reviewer-1' } },
        },
      },
    });
  });

  it('does not scope a global operator workspace query', () => {
    expect(
      getWorkspaceScopeWhere({
        id: 'operator-1',
        email: 'operator@example.com',
        role: 'operator',
      })
    ).toEqual({});
  });

  it('rejects a reviewer from a global operator operation', async () => {
    authState.user = {
      id: 'reviewer-1',
      email: 'reviewer@example.com',
      role: 'reviewer',
    };
    await expect(assertOperator()).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Operator role required',
    });
  });
});
