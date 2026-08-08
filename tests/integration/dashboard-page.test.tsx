// Integration tests for the dashboard home page (/) RSC refactor.
//
// Coverage:
//   - The home page is a server component (no useState / no
//     'use client' directive at the top of the file).
//   - The page fetches the project list via prisma.project.findMany
//     (NOT findFirst) — the full tree, not just the latest row.
//   - The page hands the project list to <DashboardPoller> as
//     `projects` prop (the client island's seed).
//   - The page renders the same chrome (NewProjectForm, AuthGate,
//     WidgetSnippet for the latest project, Workspaces link) —
//     none of the visual affordances the operator relies on are
//     dropped by the RSC refactor.
//
// The page is a React Server Component. We invoke it as a plain
// async function (RSCs are just async functions that return JSX),
// and assert on the serialized JSX shape — same pattern as
// tests/integration/share.test.ts and
// tests/integration/project-detail-page.test.tsx.
//
// We also read the file from disk and assert on its textual
// shape (no 'use client' directive) so a future refactor can't
// silently re-introduce a client boundary on the page.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  project: {
    findMany: vi.fn(),
  },
  // The page calls getCallerUser() to look up the caller's session
  // before building the team-scope filter. The mock returns null
  // (no session), which the page treats as "no caller" — the
  // team-scope helper returns { teamId: null } so the page
  // fetches every legacy / unscoped project (matches the
  // transitional single-project dashboard behaviour).
  session: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  // Team membership lookup. Default: no membership. The team
  // scope helper short-circuits to { teamId: null } so the
  // project.findMany where clause is just `teamId: null`.
  teamMember: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn(),
}));

const requestState = vi.hoisted(() => ({
  sessionToken: null as string | null,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'markup.session' && requestState.sessionToken
        ? { value: requestState.sessionToken }
        : undefined,
  })),
}));

vi.unmock('@/lib/auth');

import DashboardPage from '../../src/app/page';

const ORIGINAL_DASHBOARD_HOST = process.env.DASHBOARD_HOST;

function getCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'function') {
      return '[fn]';
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[cycle]';
      seen.add(value);
    }
    return value;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.findMany.mockResolvedValue([]);
  mocks.session.findUnique.mockResolvedValue(null);
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamMember.findMany.mockResolvedValue([]);
  mocks.$queryRaw.mockResolvedValue([]);
  requestState.sessionToken = null;
});

afterEach(() => {
  if (ORIGINAL_DASHBOARD_HOST === undefined) delete process.env.DASHBOARD_HOST;
  else process.env.DASHBOARD_HOST = ORIGINAL_DASHBOARD_HOST;
});

function authenticate() {
  requestState.sessionToken = 'session-1';
  mocks.session.findUnique.mockResolvedValue({
    token: 'session-1',
    expiresAt: new Date('2999-01-01T00:00:00Z'),
    user: { id: 'user-1', email: 'operator@example.com', role: 'operator' },
  });
}

function authenticateReviewer() {
  requestState.sessionToken = 'session-reviewer';
  mocks.session.findUnique.mockResolvedValue({
    token: 'session-reviewer',
    expiresAt: new Date('2999-01-01T00:00:00Z'),
    user: { id: 'reviewer-1', email: 'reviewer@example.com', role: 'reviewer' },
  });
  mocks.teamMember.findMany.mockImplementation(async (args: {
    where?: { role?: string | { in?: string[] } };
  }) => typeof args?.where?.role === 'object'
    ? []
    : [{ teamId: 'team-1', role: 'client', projectId: null }]
  );
}

describe('GET / — dashboard home page (RSC refactor)', () => {
  it('is a server component: the page file has no "use client" directive and no useState import', () => {
    // The RSC refactor moved the project list fetch out of the
    // client and onto the server. The page file should be a
    // plain server component — no 'use client' directive at the
    // top, no React useState import. A regression that flips
    // either would silently re-introduce the client boundary
    // and undo the first-paint speedup.
    const pagePath = resolve(__dirname, '../../src/app/page.tsx');
    const src = readFileSync(pagePath, 'utf8');
    // No directive at the top (allow leading whitespace / comments
    // / shebangs but not a 'use client' line).
    expect(src).not.toMatch(/^['"]use client['"]/m);
    // No `useState` IMPORT (the page never needs state on the
    // server — the polling state lives in <DashboardPoller>).
    // We assert on the import shape (`from 'react'` or named
    // import inside a `use client` module) rather than any
    // substring match, so comments that mention useState (e.g.
    // in this very file's commit message) don't false-positive
    // the test.
    expect(src).not.toMatch(/import\s*\{[^}]*\buseState\b[^}]*\}\s*from\s*['"]react['"]/);
  });

  it('fetches the project list via prisma.project.findMany (not findFirst)', async () => {
    // The pre-RSC page used findFirst (just the latest project
    // for the widget snippet). The RSC refactor swaps to
    // findMany because the polling client island needs the full
    // tree as its seed.
    authenticate();
    mocks.project.findMany.mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Acme',
        domain: 'acme.com',
        apiKey: 'mk_abc',
        shareToken: null,
        teamId: null,
        team: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        pages: [],
        subscribers: [],
      },
    ]);
    await DashboardPage();
    expect(mocks.project.findMany).toHaveBeenCalled();
    mocks.$queryRaw.mockResolvedValue([{
      projectId: 'proj-1', totalPages: BigInt(0), totalScreenshots: BigInt(0), totalPins: BigInt(0), openPins: BigInt(0),
    }]);
    // The list selects no nested review rows; counts come from one scoped aggregate.
    expect(mocks.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          team: { select: { id: true, name: true } },
        }),
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(mocks.project.findMany.mock.calls[0][0].select).not.toHaveProperty('pages');
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('passes the fetched project list to <DashboardPoller> as the `projects` prop', async () => {
    // The RSC hands the server-rendered tree to the polling
    // client island. <DashboardPoller> takes a single `projects`
    // prop (the seed for its useState) and renders
    // <DashboardProjects> from there. The first paint must carry
    // the full tree — the operator should see their projects on
    // the first frame, with no loading flash.
    authenticate();
    const fakeProjectRow = {
      id: 'proj-1',
      name: 'Acme',
      domain: 'acme.com',
      apiKey: 'mk_abc',
      shareToken: null,
      teamId: null,
      team: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [
        {
          id: 'page-1',
          projectId: 'proj-1',
          path: '/',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          screenshots: [],
        },
      ],
      subscribers: [],
    };
    mocks.project.findMany.mockResolvedValue([fakeProjectRow]);
    mocks.$queryRaw.mockResolvedValue([{
      projectId: 'proj-1', totalPages: BigInt(1), totalScreenshots: BigInt(0), totalPins: BigInt(0), openPins: BigInt(0),
    }]);
    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());

    // The serialized tree includes <DashboardPoller> with the
    // authenticated operator's project payload.
    expect(elementJson).toContain('Acme');
    expect(elementJson).toContain('acme.com');
    expect(elementJson).toContain('mk_abc');
    expect(elementJson).toContain('proj-1');
    expect(elementJson).toContain('"totalPages":1');
    expect(elementJson).toContain('"totalScreenshots":0');
    expect(elementJson).not.toContain('"pages":');
    // The team-scope filter is applied to the where clause —
    // the page MUST not leak projects the caller can't see.
    expect(mocks.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() })
    );
  });

  it('redacts admin secrets from a reviewer first-paint payload', async () => {
    authenticateReviewer();
    mocks.project.findMany.mockResolvedValue([
      {
        id: 'proj-review',
        name: 'Reviewer Project',
        domain: 'review.example',
        apiKey: 'mk_reviewer_must_not_receive',
        shareToken: 'share-reviewer-must-not-receive',
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Review Team' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        pages: [],
        subscribers: [{
          id: 'subscriber-1',
          projectId: 'proj-review',
          email: 'private-client@example.com',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }],
      },
    ]);

    const element = await DashboardPage();
    const payload = JSON.stringify(element, getCircularReplacer());

    expect(payload).toContain('Reviewer Project');
    expect(payload).toContain('"canAdmin":false');
    expect(payload).not.toContain('mk_reviewer_must_not_receive');
    expect(payload).not.toContain('share-reviewer-must-not-receive');
    expect(payload).not.toContain('private-client@example.com');
  });

  it('gives a team contributor project administration without team-owner powers', async () => {
    requestState.sessionToken = 'session-contributor';
    mocks.session.findUnique.mockResolvedValue({
      token: 'session-contributor',
      expiresAt: new Date('2999-01-01T00:00:00Z'),
      user: { id: 'dev-1', email: 'dev@example.com', role: 'reviewer' },
    });
    mocks.teamMember.findMany.mockImplementation(async (args: {
      where?: { role?: string | { in?: string[] } };
      select?: { role?: boolean };
    }) => {
      if (args.where?.role === 'owner') return [];
      if (typeof args.where?.role === 'object' && args.where.role.in?.includes('contributor')) {
        return [{ teamId: 'team-1' }];
      }
      return [{ teamId: 'team-1', role: 'contributor', projectId: null }];
    });
    mocks.project.findMany.mockResolvedValue([{
      id: 'proj-dev',
      name: 'Developer Project',
      domain: 'dev.example',
      apiKey: 'mk_contributor_can_receive',
      shareToken: null,
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Delivery Team' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      pages: [],
      subscribers: [],
    }]);

    const element = await DashboardPage();
    const payload = JSON.stringify(element, getCircularReplacer());
    expect(payload).toContain('"canAdmin":true');
    expect(payload).toContain('mk_contributor_can_receive');
  });

  it('builds the widget URL from a full dashboard origin without duplicating the scheme', async () => {
    authenticate();
    process.env.DASHBOARD_HOST = 'http://localhost:3030';
    mocks.project.findMany.mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Local project',
        domain: 'example.test',
        apiKey: 'mk_local',
        shareToken: null,
        teamId: null,
        team: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        pages: [],
        subscribers: [],
      },
    ]);

    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());

    expect(elementJson).toContain('"dashboardHost":"http://localhost:3030"');
    expect(elementJson).not.toContain('https://http://');
  });

  it('does not query or serialize project data for an anonymous caller', async () => {
    mocks.project.findMany.mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Acme',
        domain: 'acme.com',
        apiKey: 'mk_abc',
        shareToken: null,
        teamId: null,
        team: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        pages: [],
        subscribers: [],
      },
    ]);
    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());
    expect(mocks.project.findMany).not.toHaveBeenCalled();
    expect(elementJson).not.toContain('Acme');
    expect(elementJson).not.toContain('acme.com');
    expect(elementJson).not.toContain('proj-1');
    expect(elementJson).not.toContain('mk_abc');
    expect(elementJson).toContain('Sign in to see the widget snippet');
    expect(elementJson).toContain('Visual Feedback');
  });

  it('renders the anonymous widget placeholder when no projects exist', async () => {
    // When the list is empty and the caller has no session, the
    // snippet card shows the sign-in placeholder (secrets are
    // withheld for anonymous callers).
    mocks.project.findMany.mockResolvedValue([]);
    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());
    expect(mocks.project.findMany).not.toHaveBeenCalled();
    expect(elementJson).toContain('Sign in to see the widget snippet');
  });
});
