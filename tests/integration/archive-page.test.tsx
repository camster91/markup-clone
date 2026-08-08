import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  admin: true,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { project: mocks.project } }));
vi.mock('@/lib/teams', () => ({
  getCallerUser: vi.fn(async () => ({ id: 'operator-1', email: 'operator@example.com', role: 'operator' })),
  getProjectScopeWhere: vi.fn(async () => ({})),
  getCallerAdminTeamIds: vi.fn(async () => []),
  canAdminProject: vi.fn(() => mocks.admin),
}));

import ArchivePage from '@/app/archive/page';

function serialize(value: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'function') return '[fn]';
    if (current && typeof current === 'object') {
      if (seen.has(current)) return '[cycle]';
      seen.add(current);
    }
    return current;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin = true;
  mocks.project.findMany.mockResolvedValue([{
    id: 'site-1', name: 'Acme', domain: 'acme.example', apiKey: 'mk_private', shareToken: 'share_private',
    teamId: 'client-1', archivedAt: new Date('2026-08-08T12:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-08T12:00:00.000Z'),
    team: { id: 'client-1', name: 'Acme client' }, pages: [],
  }]);
});

describe('archived sites page', () => {
  it('queries only authorized archived sites and redacts setup secrets', async () => {
    const element = await ArchivePage();
    const payload = serialize(element);
    expect(mocks.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{}, { archivedAt: { not: null } }] },
      orderBy: { archivedAt: 'desc' },
    }));
    expect(payload).toContain('Archived sites');
    expect(payload).toContain('Acme');
    expect(payload).not.toContain('mk_private');
    expect(payload).not.toContain('share_private');
  });

  it('does not serialize archived sites the caller cannot administer', async () => {
    mocks.admin = false;
    const payload = serialize(await ArchivePage());
    expect(payload).not.toContain('acme.example');
  });
});
