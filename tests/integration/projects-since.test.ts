import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  teamMember: { findMany: vi.fn().mockResolvedValue([]) },
  $queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));

import { GET } from '@/app/api/projects/route';

function request(query = ''): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects${query}`, {
    headers: { origin: 'https://markup.ashbi.ca' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamMember.findMany.mockResolvedValue([]);
  mocks.$queryRaw.mockResolvedValue([{
    projectId: 'project-1', totalPages: BigInt(1), totalScreenshots: BigInt(2), totalPins: BigInt(3), openPins: BigInt(2),
  }]);
  mocks.project.findMany.mockResolvedValue([
    {
      id: 'project-1',
      name: 'Acme',
      domain: 'acme.example',
      apiKey: 'mk_secret',
      shareToken: null,
      archivedAt: null,
      teamId: null,
      team: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      pages: [
        {
          screenshots: [
            { pins: [{ status: 'OPEN' }, { status: 'RESOLVED' }] },
            { pins: [{ status: 'OPEN' }] },
          ],
        },
      ],
    },
  ]);
});

describe('GET /api/projects compact polling DTO', () => {
  it('returns card counts without capture or feedback bodies', async () => {
    const response = await GET(request());
    const [project] = await response.json();

    expect(response.status).toBe(200);
    expect(project).toMatchObject({
      id: 'project-1',
      archivedAt: null,
      totalPages: 1,
      totalScreenshots: 2,
      totalPins: 3,
      openPins: 2,
    });
    expect(project).not.toHaveProperty('pages');
    expect(project).not.toHaveProperty('subscribers');
    const query = mocks.project.findMany.mock.calls[0][0];
    expect(query.select).not.toHaveProperty('pages');
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns deterministic zero counts when a project has no aggregate row', async () => {
    mocks.$queryRaw.mockResolvedValue([]);
    const response = await GET(request());
    const [project] = await response.json();

    expect(project).toMatchObject({
      totalPages: 0, totalScreenshots: 0, totalPins: 0, openPins: 0,
    });
  });

  it('returns a complete compact list even when an old since cursor is supplied', async () => {
    const response = await GET(request('?since=2026-01-01T00:00:00.000Z'));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(mocks.project.findMany.mock.calls[0][0].where).not.toHaveProperty('updatedAt');
  });

  it('shows only active projects by default', async () => {
    await GET(request());
    expect(mocks.project.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ teamId: null }, { archivedAt: null }],
    });
  });

  it('supports explicit archived and all views without dropping team scope', async () => {
    await GET(request('?state=archived'));
    expect(mocks.project.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ teamId: null }, { archivedAt: { not: null } }],
    });

    await GET(request('?state=all'));
    expect(mocks.project.findMany.mock.calls[1][0].where).toEqual({ teamId: null });
  });

  it('rejects an unsupported project state', async () => {
    const response = await GET(request('?state=deleted'));
    expect(response.status).toBe(400);
    expect(mocks.project.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 without a dashboard origin', async () => {
    const response = await GET(new NextRequest('https://markup.ashbi.ca/api/projects'));
    expect(response.status).toBe(401);
    expect(mocks.project.findMany).not.toHaveBeenCalled();
  });
});
