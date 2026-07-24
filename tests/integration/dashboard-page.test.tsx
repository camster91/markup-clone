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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { liveSessionRow } from '../helpers/dashboard-auth';

const mocks = vi.hoisted(() => ({
  project: {
    findMany: vi.fn(),
  },
  // Logged-in operator by default — the page skips the project
  // query entirely when there is no session (avoids serializing
  // apiKey into HTML for anonymous visitors).
  session: {
    findUnique: vi.fn(),
  },
  // Team membership lookup. Default: no membership. The team
  // scope helper short-circuits to { teamId: null } so the
  // project.findMany where clause is just `teamId: null`.
  teamMember: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

const cookieStore = vi.hoisted(() => {
  const data: { value?: string } = { value: 'test-dashboard-session' };
  return {
    data,
    get: (name: string) => (data.value !== undefined ? { name, value: data.value } : undefined),
    set: (_n: string, value: string) => { data.value = value === '' ? undefined : value; },
    delete: () => { data.value = undefined; },
    has: () => data.value !== undefined,
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import DashboardPage from '../../src/app/page';

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
  cookieStore.data.value = 'test-dashboard-session';
  mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  mocks.project.findMany.mockResolvedValue([]);
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamMember.findMany.mockResolvedValue([]);
});

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
    // The full tree include shape — pages, screenshots, pins,
    // comments, annotations, subscribers, team. The polling
    // client island renders from this payload, so the include
    // shape must match the /api/projects route (or the first
    // paint and the polled deltas would diverge).
    expect(mocks.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          pages: expect.objectContaining({
            include: expect.objectContaining({
              screenshots: expect.objectContaining({
                include: expect.objectContaining({
                  pins: expect.objectContaining({
                    include: expect.objectContaining({
                      comments: expect.anything(),
                      annotations: expect.anything(),
                    }),
                  }),
                }),
              }),
            }),
          }),
          subscribers: true,
          team: { select: { id: true, name: true } },
        }),
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('passes the fetched project list to <DashboardPoller> as the `projects` prop', async () => {
    // The RSC hands the server-rendered tree to the polling
    // client island. <DashboardPoller> takes a single `projects`
    // prop (the seed for its useState) and renders
    // <DashboardProjects> from there. The first paint must carry
    // the full tree — the operator should see their projects on
    // the first frame, with no loading flash.
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
    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());

    // The serialized tree includes <DashboardPoller> with the
    // full project payload. Asserting on the project name + id
    // + domain + apiKey is enough to confirm the prop was
    // threaded: a regression that drops the prop (or wraps it
    // in a different element) would lose the project name.
    expect(elementJson).toContain('Acme');
    expect(elementJson).toContain('acme.com');
    expect(elementJson).toContain('mk_abc');
    expect(elementJson).toContain('proj-1');
    // The page path also makes it through the include — the
    // client island needs the full path / screenshot / pin
    // tree to render the "N pages · M captures" affordance on
    // the compact card without a follow-up fetch.
    expect(elementJson).toContain('"path":"/"');
    // The team-scope filter is applied to the where clause —
    // the page MUST not leak projects the caller can't see.
    expect(mocks.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() })
    );
  });

  it('still renders the chrome (WidgetSnippet, NewProjectForm, AuthGate, Workspaces link)', async () => {
    // The RSC refactor must not drop any of the visual
    // affordances the operator relies on. The widget snippet
    // is derived from the latest project in the list (the
    // first row of the orderBy: createdAt desc fetch). The
    // NewProjectForm / AuthGate / Workspaces link are all
    // client components that stay as-is.
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
    // The widget snippet renders the project's apiKey + id
    // inside a <code> block. Both must survive the RSC
    // serialization.
    expect(elementJson).toContain('mk_abc');
    expect(elementJson).toContain('proj-1');
    // The Workspaces link is still in the header.
    expect(elementJson).toContain('/workspaces');
    // The header H1 is still there.
    expect(elementJson).toContain('Visual Feedback');
  });

  it('renders the "create a project" empty state when no projects exist', async () => {
    // The pre-RSC page already handled the empty case (no
    // widget snippet card). The RSC refactor must keep that
    // behaviour: when the list is empty, the snippet card
    // shows the "Create a project below" placeholder instead
    // of the snippet itself.
    mocks.project.findMany.mockResolvedValue([]);
    const element = await DashboardPage();
    const elementJson = JSON.stringify(element, getCircularReplacer());
    expect(elementJson).toContain('Create a project below to get a widget snippet');
  });

  it('skips the project query when there is no session (no apiKey leak)', async () => {
    cookieStore.data.value = undefined;
    mocks.session.findUnique.mockResolvedValue(null);
    mocks.project.findMany.mockResolvedValue([
      { id: 'proj-1', name: 'Secret', apiKey: 'mk_secret', pages: [], subscribers: [] },
    ]);
    const element = await DashboardPage();
    expect(mocks.project.findMany).not.toHaveBeenCalled();
    const elementJson = JSON.stringify(element, getCircularReplacer());
    expect(elementJson).not.toContain('mk_secret');
    expect(elementJson).toContain('Create a project below to get a widget snippet');
  });
});
