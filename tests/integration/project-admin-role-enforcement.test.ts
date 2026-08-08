import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'project-admin-csrf';

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  project: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  teamMember: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  team: { findUnique: vi.fn() },
  screenshot: { findMany: vi.fn() },
  integration: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  integrationDelivery: { findMany: vi.fn(), updateMany: vi.fn() },
  subscriber: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
    requireAuth: vi.fn(async () => ({
      id: 'reviewer-1',
      email: 'reviewer@example.com',
      role: 'reviewer',
    })),
  };
});
vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>();
  return { ...actual };
});
vi.mock('fs/promises', () => ({ unlink: vi.fn() }));

import { GET as listProjects, POST as createProject } from '@/app/api/projects/route';
import { GET as loadProject, PATCH as updateProject, DELETE as deleteProject } from '@/app/api/projects/[id]/route';
import { POST as createShare, DELETE as revokeShare } from '@/app/api/projects/[id]/share/route';
import {
  GET as listIntegrations,
  POST as createIntegration,
} from '@/app/api/projects/[id]/integrations/route';
import { DELETE as deleteIntegration } from '@/app/api/projects/[id]/integrations/[integrationId]/route';
import { POST as testIntegration } from '@/app/api/projects/[id]/integrations/test/route';
import { GET as listIntegrationDeliveries } from '@/app/api/projects/[id]/integrations/deliveries/route';
import { POST as retryIntegrationDelivery } from '@/app/api/projects/[id]/integrations/deliveries/[deliveryId]/retry/route';
import {
  GET as listSubscribers,
  POST as createSubscriber,
} from '@/app/api/projects/[id]/subscribers/route';
import { DELETE as deleteSubscriber } from '@/app/api/projects/[id]/subscribers/[email]/route';

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca${path}`, {
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

const params = { params: Promise.resolve({ id: PROJECT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.$queryRaw.mockResolvedValue([]);
  mocks.project.findUnique.mockResolvedValue({
    id: PROJECT_ID,
    name: 'Client Site',
    domain: 'example.com',
    teamId: TEAM_ID,
    shareToken: 'active-share-token',
  });
  mocks.teamMember.findFirst.mockResolvedValue({ id: 'member-1', role: 'reviewer' });
  mocks.teamMember.findMany.mockImplementation(async (args: { where?: { role?: string | { in?: string[] } } }) => {
    const role = args?.where?.role;
    const isAdminRoleQuery = role === 'owner'
      || (typeof role === 'object' && role?.in?.some((value) => value === 'owner' || value === 'contributor'));
    return isAdminRoleQuery ? [] : [{ teamId: TEAM_ID }];
  });
  mocks.team.findUnique.mockResolvedValue({ id: TEAM_ID });
  mocks.project.create.mockResolvedValue({ id: PROJECT_ID, teamId: TEAM_ID });
  mocks.project.update.mockResolvedValue({ id: PROJECT_ID, teamId: TEAM_ID });
  mocks.project.delete.mockResolvedValue({ id: PROJECT_ID });
  mocks.screenshot.findMany.mockResolvedValue([]);
  mocks.integration.findMany.mockResolvedValue([]);
  mocks.integration.create.mockResolvedValue({ id: 'integration-1' });
  mocks.integration.deleteMany.mockResolvedValue({ count: 1 });
  mocks.subscriber.findMany.mockResolvedValue([]);
  mocks.subscriber.create.mockResolvedValue({ id: 'subscriber-1' });
  mocks.subscriber.deleteMany.mockResolvedValue({ count: 1 });
  mocks.project.findMany.mockResolvedValue([
    {
      id: PROJECT_ID,
      name: 'Client Site',
      domain: 'example.com',
      apiKey: 'mk_secret_key',
      shareToken: 'active-share-token',
      teamId: TEAM_ID,
      team: { id: TEAM_ID, name: 'Client Team' },
      createdAt: new Date('2026-08-07T12:00:00Z'),
      updatedAt: new Date('2026-08-07T12:00:00Z'),
      pages: [],
      subscribers: [{ id: 'subscriber-1', email: 'client@example.com' }],
    },
  ]);
});

describe('reviewer project administration', () => {
  it('keeps contributor administration and its precise access role on project refresh', async () => {
    mocks.teamMember.findFirst.mockResolvedValue({
      id: 'member-dev', role: 'contributor', projectId: null,
    });
    mocks.project.findUnique
      .mockResolvedValueOnce({ id: PROJECT_ID, teamId: TEAM_ID })
      .mockResolvedValueOnce({
        id: PROJECT_ID, name: 'Client Site', domain: 'example.com',
        apiKey: 'mk_contributor_key', shareToken: null, teamId: TEAM_ID,
        activeReviewRoundId: null, pages: [],
      });
    const response = await loadProject(request(`/api/projects/${PROJECT_ID}`, 'GET'), params);
    const project = await response.json();
    expect(project).toMatchObject({
      id: PROJECT_ID, canAdmin: true, apiKey: 'mk_contributor_key', accessRole: 'contributor',
    });
  });

  it('redacts project administration secrets from the reviewer project list', async () => {
    const response = await listProjects(request('/api/projects', 'GET'));
    const [project] = await response.json();

    expect(response.status).toBe(200);
    expect(project).toMatchObject({
      id: PROJECT_ID,
      canAdmin: false,
      apiKey: null,
      shareToken: null,
      totalPages: 0,
      totalScreenshots: 0,
      totalPins: 0,
      openPins: 0,
    });
    expect(project).not.toHaveProperty('pages');
    expect(project).not.toHaveProperty('subscribers');
    expect(JSON.stringify(project)).not.toContain('mk_secret_key');
    expect(JSON.stringify(project)).not.toContain('client@example.com');
  });

  it('blocks a reviewer from creating a project in their team', async () => {
    const response = await createProject(
      request('/api/projects', 'POST', {
        name: 'Client Site',
        domain: 'example.com',
        teamId: TEAM_ID,
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.project.create).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from renaming or rotating a project key', async () => {
    const response = await updateProject(
      request(`/api/projects/${PROJECT_ID}`, 'PATCH', {
        name: 'Renamed Site',
        regenerateKey: true,
      }),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from deleting a project', async () => {
    const response = await deleteProject(
      request(`/api/projects/${PROJECT_ID}`, 'DELETE'),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.project.delete).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from generating a public share link', async () => {
    const response = await createShare(
      request(`/api/projects/${PROJECT_ID}/share`, 'POST'),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from revoking a public share link', async () => {
    const response = await revokeShare(
      request(`/api/projects/${PROJECT_ID}/share`, 'DELETE'),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from viewing integration settings', async () => {
    const response = await listIntegrations(
      request(`/api/projects/${PROJECT_ID}/integrations`, 'GET'),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.integration.findMany).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from adding an integration', async () => {
    const response = await createIntegration(
      request(`/api/projects/${PROJECT_ID}/integrations`, 'POST', {
        kind: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/services/a/b/c' },
      }),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.integration.create).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from deleting an integration', async () => {
    const response = await deleteIntegration(
      request(`/api/projects/${PROJECT_ID}/integrations/integration-1`, 'DELETE'),
      { params: Promise.resolve({ id: PROJECT_ID, integrationId: 'integration-1' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.integration.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from testing an integration', async () => {
    const response = await testIntegration(
      request(`/api/projects/${PROJECT_ID}/integrations/test`, 'POST', {
        integrationId: 'integration-1',
      }),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.integration.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from viewing integration delivery activity', async () => {
    const response = await listIntegrationDeliveries(
      request(`/api/projects/${PROJECT_ID}/integrations/deliveries`, 'GET'),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.integrationDelivery.findMany).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from retrying an integration delivery', async () => {
    const deliveryId = '33333333-3333-4333-8333-333333333333';
    const response = await retryIntegrationDelivery(
      request(`/api/projects/${PROJECT_ID}/integrations/deliveries/${deliveryId}/retry`, 'POST'),
      { params: Promise.resolve({ id: PROJECT_ID, deliveryId }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.integrationDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from viewing subscriber settings', async () => {
    const response = await listSubscribers(
      request(`/api/projects/${PROJECT_ID}/subscribers`, 'GET'),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.subscriber.findMany).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from adding a subscriber', async () => {
    const response = await createSubscriber(
      request(`/api/projects/${PROJECT_ID}/subscribers`, 'POST', {
        email: 'client@example.com',
      }),
      params
    );

    expect(response.status).toBe(403);
    expect(mocks.subscriber.create).not.toHaveBeenCalled();
  });

  it('blocks a reviewer from deleting a subscriber', async () => {
    const response = await deleteSubscriber(
      request(`/api/projects/${PROJECT_ID}/subscribers/client%40example.com`, 'DELETE'),
      { params: Promise.resolve({ id: PROJECT_ID, email: 'client@example.com' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.subscriber.deleteMany).not.toHaveBeenCalled();
  });
});
