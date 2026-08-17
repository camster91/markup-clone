import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: null as string | null,
}));

const mocks = vi.hoisted(() => ({
  workspace: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  team: { findFirst: vi.fn() },
  session: { findUnique: vi.fn() },
  teamMember: { findMany: vi.fn(), findFirst: vi.fn() },
}));

const navigation = vi.hoisted(() => ({
  redirects: [] as string[],
  notFoundCount: 0,
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'markup.session' && state.token ? { value: state.token } : undefined,
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    navigation.redirects.push(path);
    throw Object.assign(new Error('NEXT_REDIRECT'), { __redirect: path });
  },
  notFound: () => {
    navigation.notFoundCount += 1;
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { __notFound: true });
  },
}));
vi.unmock('@/lib/auth');

import WorkspacesPage from '@/app/workspaces/page';
import WorkspaceDetailPage from '@/app/workspaces/[id]/page';
import TeamDetailPage from '@/app/workspaces/[id]/teams/[teamId]/page';

function serialize(element: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(element, (_key, value) => {
    if (typeof value === 'function') return '[fn]';
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[cycle]';
      seen.add(value);
    }
    return value;
  });
}

function authenticate(role: 'operator' | 'reviewer' = 'reviewer') {
  state.token = 'session-1';
  mocks.session.findUnique.mockResolvedValue({
    token: 'session-1',
    expiresAt: new Date('2999-01-01T00:00:00Z'),
    user: {
      id: role === 'operator' ? 'operator-1' : 'reviewer-1',
      email: `${role}@example.com`,
      role,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  navigation.redirects.length = 0;
  navigation.notFoundCount = 0;
  mocks.session.findUnique.mockResolvedValue(null);
  mocks.workspace.findMany.mockResolvedValue([]);
  mocks.workspace.findFirst.mockResolvedValue(null);
  mocks.workspace.findUnique.mockResolvedValue(null);
  mocks.team.findFirst.mockResolvedValue(null);
});

describe('team detail server page', () => {
  it('renders client review access without exposing the team member directory', async () => {
    authenticate('reviewer');
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-client', role: 'client', projectId: null,
    });
    mocks.team.findFirst.mockImplementation(async (args: { select?: unknown }) =>
      args.select
        ? { id: 'team-1', workspaceId: 'workspace-1' }
        : {
            id: 'team-1',
            workspaceId: 'workspace-1',
            name: 'Client Delivery',
            workspace: { id: 'workspace-1', name: 'Agency Workspace' },
            members: [{ id: 'member-client', email: 'client@example.com', role: 'client' }],
            projects: [{ id: 'project-1', name: 'Acme Site', domain: 'acme.example' }],
          }
    );

    const element = await TeamDetailPage({
      params: Promise.resolve({ id: 'workspace-1', teamId: 'team-1' }),
    });
    const payload = serialize(element);

    expect(payload).toContain('Client Delivery');
    expect(payload).toContain('Acme Site');
    expect(payload).toContain('Sites');
    expect(payload).not.toContain('client@example.com');
    expect(payload).toContain('Client review access');
    expect(payload).not.toContain('"teamId":"team-1"');
  });

  it('lets a contributor create projects without exposing people controls', async () => {
    authenticate('reviewer');
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-dev', role: 'contributor', projectId: null,
    });
    mocks.team.findFirst.mockImplementation(async (args: { select?: unknown }) =>
      args.select
        ? { id: 'team-1', workspaceId: 'workspace-1' }
        : {
            id: 'team-1', workspaceId: 'workspace-1', name: 'Delivery Team',
            workspace: { id: 'workspace-1', name: 'Agency Workspace' },
            members: [{ id: 'owner-1', email: 'owner@example.com', role: 'owner' }],
            projects: [],
          },
    );
    const element = await TeamDetailPage({
      params: Promise.resolve({ id: 'workspace-1', teamId: 'team-1' }),
    });
    const payload = serialize(element);
    expect(payload).toContain('Contributor access');
    expect(payload).toContain('"teamId":"team-1"');
    expect(payload).not.toContain('owner@example.com');
  });

  it('redirects a guest directly to the granted project without loading team data', async () => {
    authenticate('reviewer');
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-guest', role: 'guest', projectId: 'project-guest',
    });
    mocks.team.findFirst.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { id: 'team-1', workspaceId: 'workspace-1' } : null,
    );
    await expect(TeamDetailPage({
      params: Promise.resolve({ id: 'workspace-1', teamId: 'team-1' }),
    })).rejects.toMatchObject({ __redirect: '/projects/project-guest' });
    expect(mocks.team.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('workspace server-page authorization', () => {
  it('redirects an anonymous workspace index request before querying data', async () => {
    await expect(WorkspacesPage()).rejects.toMatchObject({
      __redirect: '/?next=%2Fworkspaces#sign-in',
    });
    expect(mocks.workspace.findMany).not.toHaveBeenCalled();
  });

  it('scopes a reviewer workspace index query to their memberships', async () => {
    authenticate('reviewer');
    await WorkspacesPage();
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teams: {
            some: {
              members: { some: { userId: 'reviewer-1' } },
            },
          },
        },
      })
    );
  });

  it('rejects an anonymous workspace detail request before loading it', async () => {
    mocks.workspace.findUnique.mockResolvedValue({
      id: 'workspace-private',
      name: 'Private Agency',
      teams: [],
    });
    await expect(
      WorkspaceDetailPage({ params: Promise.resolve({ id: 'workspace-private' }) })
    ).rejects.toMatchObject({
      __redirect: '/?next=%2Fworkspaces%2Fworkspace-private#sign-in',
    });
    expect(mocks.workspace.findUnique).not.toHaveBeenCalled();
    expect(mocks.workspace.findFirst).not.toHaveBeenCalled();
  });

  it('gives an operator the workspace branding editor with current safe values', async () => {
    authenticate('operator');
    mocks.workspace.findFirst.mockResolvedValue({
      id: 'workspace-operator', name: 'Internal Workspace', teams: [],
      brandName: 'Northstar Studio', logoUrl: null, accentColor: '#4f46e5',
      reviewerWelcome: 'Review the latest build with us.',
    });
    const element = await WorkspaceDetailPage({
      params: Promise.resolve({ id: 'workspace-operator' }),
    });
    const payload = serialize(element);
    expect(payload).toContain('Northstar Studio');
    expect(payload).toContain('#4f46e5');
    expect(payload).toContain('Review the latest build with us.');
    expect(payload).toContain('workspace-operator');
    expect(payload).toContain('Client accounts');
  });

  it('returns 404 when a reviewer requests a workspace outside their scope', async () => {
    authenticate('reviewer');
    mocks.workspace.findUnique.mockResolvedValue({
      id: 'workspace-private',
      name: 'Other Agency',
      teams: [],
    });
    mocks.workspace.findFirst.mockResolvedValue(null);

    await expect(
      WorkspaceDetailPage({ params: Promise.resolve({ id: 'workspace-private' }) })
    ).rejects.toMatchObject({ __notFound: true });
    expect(mocks.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: 'workspace-private' },
            {
              teams: {
                some: {
                  members: { some: { userId: 'reviewer-1' } },
                },
              },
            },
          ],
        },
      })
    );
  });

  it('shows a guest only their joined team without private team or directory counts', async () => {
    authenticate('reviewer');
    mocks.workspace.findFirst.mockResolvedValue({
      id: 'workspace-guest',
      name: 'Agency Workspace',
      teams: [{
        id: 'team-guest', name: 'Client Review',
        members: [{ role: 'guest', projectId: 'project-guest' }],
        _count: { members: 8, projects: 5 },
      }],
    });

    const element = await WorkspaceDetailPage({
      params: Promise.resolve({ id: 'workspace-guest' }),
    });
    const payload = serialize(element);
    expect(payload).toContain('Client Review');
    expect(payload).toContain('1," site",""');
    expect(payload).not.toContain('8," member"');
    expect(mocks.workspace.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        teams: expect.objectContaining({
          where: { members: { some: { userId: 'reviewer-1' } } },
        }),
      }),
    }));
  });
});
