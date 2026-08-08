import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CSRF_TOKEN = 'workspace-role-csrf-token';

const mocks = vi.hoisted(() => ({
  workspace: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  team: { findMany: vi.fn(), create: vi.fn() },
}));

const access = vi.hoisted(() => ({
  assertOperator: vi.fn(),
  getCallerUser: vi.fn(),
  getWorkspaceScopeWhere: vi.fn(),
  normalizeTeamRole: (role: string | null | undefined) => role === 'reviewer' ? 'client' : role,
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => access);
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { GET as listWorkspaces, POST as createWorkspace } from '@/app/api/workspaces/route';
import {
  PATCH as updateWorkspace,
  DELETE as removeWorkspace,
} from '@/app/api/workspaces/[id]/route';
import {
  GET as listTeams,
  POST as createTeam,
} from '@/app/api/workspaces/[id]/teams/route';

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/workspaces', {
    method,
    headers: {
      Origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: WORKSPACE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  access.assertOperator.mockResolvedValue({
    ok: false,
    status: 403,
    error: 'Operator role required',
  });
  access.getCallerUser.mockResolvedValue({
    id: 'reviewer-1',
    email: 'reviewer@example.com',
    role: 'reviewer',
  });
  access.getWorkspaceScopeWhere.mockReturnValue({
    teams: { some: { members: { some: { userId: 'reviewer-1' } } } },
  });
  mocks.workspace.findMany.mockResolvedValue([]);
  mocks.workspace.findFirst.mockResolvedValue({ id: WORKSPACE_ID });
  mocks.workspace.findUnique.mockResolvedValue({
    id: WORKSPACE_ID,
    name: 'Client Workspace',
    teams: [],
  });
  mocks.workspace.create.mockResolvedValue({ id: WORKSPACE_ID, name: 'New Workspace' });
  mocks.workspace.update.mockResolvedValue({ id: WORKSPACE_ID, name: 'Renamed Workspace' });
  mocks.workspace.delete.mockResolvedValue({ id: WORKSPACE_ID });
  mocks.team.findMany.mockResolvedValue([]);
  mocks.team.create.mockResolvedValue({ id: 'team-1', workspaceId: WORKSPACE_ID, name: 'New Team' });
});

describe('workspace API authorization', () => {
  it('scopes the workspace list to the authenticated reviewer', async () => {
    const response = await listWorkspaces(request('GET'));
    expect(response.status).toBe(200);
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teams: { some: { members: { some: { userId: 'reviewer-1' } } } },
        },
      })
    );
  });

  it('blocks a reviewer from creating a workspace', async () => {
    const response = await createWorkspace(request('POST', { name: 'New Workspace' }));
    expect(response.status).toBe(403);
    expect(mocks.workspace.create).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from renaming a workspace', async () => {
    const response = await updateWorkspace(
      request('PATCH', { name: 'Renamed Workspace' }),
      params
    );
    expect(response.status).toBe(403);
    expect(mocks.workspace.update).not.toHaveBeenCalled();
  });

  it('lets an operator update normalized workspace branding without renaming it', async () => {
    access.assertOperator.mockResolvedValue({
      ok: true,
      caller: { id: 'operator-1', email: 'operator@example.com', role: 'operator' },
    });
    mocks.workspace.update.mockResolvedValue({
      id: WORKSPACE_ID,
      name: 'Client Workspace',
      brandName: 'Northstar Studio',
      logoUrl: 'https://cdn.example.com/logo.png',
      accentColor: '#4f46e5',
      reviewerWelcome: 'Review the latest build with us.',
    });
    const response = await updateWorkspace(request('PATCH', {
      brandName: '  Northstar Studio ',
      logoUrl: 'https://cdn.example.com/logo.png',
      accentColor: '#4F46E5',
      reviewerWelcome: ' Review the latest build with us. ',
    }), params);
    expect(response.status).toBe(200);
    expect(mocks.workspace.update).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID },
      data: {
        brandName: 'Northstar Studio',
        logoUrl: 'https://cdn.example.com/logo.png',
        accentColor: '#4f46e5',
        reviewerWelcome: 'Review the latest build with us.',
      },
    });
  });

  it('rejects unsafe branding before writing', async () => {
    access.assertOperator.mockResolvedValue({
      ok: true,
      caller: { id: 'operator-1', email: 'operator@example.com', role: 'operator' },
    });
    const response = await updateWorkspace(request('PATCH', {
      logoUrl: 'data:image/svg+xml,<svg onload=alert(1)>',
    }), params);
    expect(response.status).toBe(400);
    expect(mocks.workspace.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from deleting a workspace', async () => {
    const response = await removeWorkspace(request('DELETE'), params);
    expect(response.status).toBe(403);
    expect(mocks.workspace.delete).not.toHaveBeenCalled();
  });

  it('scopes a reviewer team list to their memberships', async () => {
    const response = await listTeams(request('GET'), params);
    expect(response.status).toBe(200);
    expect(mocks.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: WORKSPACE_ID,
          members: { some: { userId: 'reviewer-1' } },
        },
      })
    );
  });

  it('does not expose team-wide counts to a project guest', async () => {
    mocks.team.findMany.mockResolvedValue([{
      id: 'team-guest', workspaceId: WORKSPACE_ID, name: 'Client Review',
      createdAt: new Date('2026-08-08T00:00:00Z'), updatedAt: new Date('2026-08-08T00:00:00Z'),
      members: [{ role: 'guest', projectId: 'project-guest' }],
      _count: { members: 9, projects: 6 },
    }]);
    const response = await listTeams(request('GET'), params);
    const body = await response.json();
    expect(body[0]).toMatchObject({ id: 'team-guest', projectCount: 1 });
    expect(body[0]).not.toHaveProperty('memberCount');
  });

  it('blocks a reviewer from creating a team', async () => {
    const response = await createTeam(request('POST', { name: 'New Team' }), params);
    expect(response.status).toBe(403);
    expect(mocks.team.create).not.toHaveBeenCalled();
  });
});
