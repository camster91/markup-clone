// Integration tests for the `?since=<ISO>` delta-polling query param on
// GET /api/projects. This is the perf path that lets the dashboard poll
// every 5s without re-downloading the full project tree each time.
//
// Contract being verified:
//   - No `since`: route returns the full tree (legacy behaviour).
//   - With `since=<ISO>`: route adds a `where: { updatedAt: { gt: since } }`
//     (or `capturedAt` for Screenshot) at every nested level
//     (Project, Page, Screenshot, Pin, Comment).
//   - With `since=<ISO>`: response is still an array (empty if nothing
//     changed).
//   - Invalid `since` string: route falls back to the no-filter path
//     (we don't want a malformed cursor to brick the dashboard).
//
// The prisma client is mocked at the module level so we can inspect the
// `where` clauses passed to findMany. The mock returns canned rows so we
// can assert the response shape end-to-end.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  // The route now calls getCallerUser() to scope the result to the
  // caller's teams. The default mock returns no session, which
  // collapses to the "no teams" branch — the where clause becomes
  // { teamId: null } so the test fixtures (which don't have a
  // teamId column populated) still match. Tests that need a
  // logged-in caller with team memberships override the session +
  // teamMember mocks per-test.
  session: { findUnique: vi.fn().mockResolvedValue(null) },
  teamMember: { findMany: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

import { GET } from '../../src/app/api/projects/route';
import { NextRequest } from 'next/server';

const ORIGIN = 'https://markup.ashbi.ca';

function getReq(qs = ''): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects${qs}`, {
    method: 'GET',
    headers: { origin: ORIGIN },
  });
}

// A canned full tree: one project, one page, one screenshot, one pin,
// one comment. Returned when the route has no `since` cursor.
const fullTree = [
  {
    id: 'proj-1',
    name: 'Acme',
    domain: 'acme.com',
    apiKey: 'mk_xxx',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    pages: [
      {
        id: 'page-1',
        projectId: 'proj-1',
        path: '/',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        screenshots: [
          {
            id: 'shot-1',
            pageId: 'page-1',
            storageKey: 'a.png',
            width: 100,
            height: 100,
            capturedAt: new Date('2026-01-01T00:00:00Z'),
            pins: [
              {
                id: 'pin-1',
                screenshotId: 'shot-1',
                xPercent: 0.5,
                yPercent: 0.5,
                status: 'OPEN',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                updatedAt: new Date('2026-01-01T00:00:00Z'),
                comments: [
                  {
                    id: 'cmt-1',
                    pinId: 'pin-1',
                    author: 'Client',
                    authorRole: 'client',
                    text: 'hi',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    updatedAt: new Date('2026-01-01T00:00:00Z'),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

// A canned delta: the same project with the pin's comment updated.
// The route would have filtered down to just rows whose updatedAt is
// strictly after the cursor, so the response contains only those rows.
const deltaTree = [
  {
    id: 'proj-1',
    name: 'Acme',
    domain: 'acme.com',
    apiKey: 'mk_xxx',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    pages: [
      {
        id: 'page-1',
        projectId: 'proj-1',
        path: '/',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        screenshots: [
          {
            id: 'shot-1',
            pageId: 'page-1',
            storageKey: 'a.png',
            width: 100,
            height: 100,
            capturedAt: new Date('2026-01-01T00:00:00Z'),
            pins: [
              {
                id: 'pin-1',
                screenshotId: 'shot-1',
                xPercent: 0.5,
                yPercent: 0.5,
                status: 'OPEN',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                updatedAt: new Date('2026-01-01T00:00:00Z'),
                comments: [
                  {
                    id: 'cmt-2',
                    pinId: 'pin-1',
                    author: 'Reviewer',
                    authorRole: 'reviewer',
                    text: 'fixed',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    updatedAt: new Date('2026-06-15T12:00:00Z'),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/projects — ?since= delta polling', () => {
  it('first poll (no since) returns the full tree', async () => {
    mocks.project.findMany.mockResolvedValue(fullTree);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('proj-1');
    expect(body[0].pages[0].screenshots[0].pins[0].comments[0].text).toBe('hi');

    // The `where` clause on the top-level findMany is the F9
    // team-scope filter (security: callers always see only
    // their own teams). It is an `{ AND: [teamScope] }` object
    // when there's no cursor (no since filter inside the AND).
    const call = mocks.project.findMany.mock.calls[0][0];
    expect(call.where.AND).toBeDefined();
    expect(call.where.AND).toHaveLength(1);
  });

  it('with since=<ISO>, sends an updatedAt filter on every nested level', async () => {
    mocks.project.findMany.mockResolvedValue(deltaTree);
    const cursor = '2026-06-15T11:59:30.000Z';
    const res = await GET(getReq(`?since=${encodeURIComponent(cursor)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Only the comment that was updated after the cursor is in the delta.
    expect(body[0].pages[0].screenshots[0].pins[0].comments[0].id).toBe('cmt-2');

    // The top-level where must be { updatedAt: { gt: <Date> } }.
    const call = mocks.project.findMany.mock.calls[0][0];
    // F9 wraps the where in an AND with the team-scope filter.
    // The second AND element is the since filter.
    expect(call.where.AND).toHaveLength(2);
    expect(call.where.AND[1]).toEqual({ updatedAt: { gt: new Date(cursor) } });

    // The nested includes must each carry the same cursor filter so the
    // server prunes the tree at every level — not just the top.
    const pages = call.include.pages;
    expect(pages.where).toEqual({ updatedAt: { gt: new Date(cursor) } });
    const screenshots = pages.include.screenshots;
    // Screenshot has no `updatedAt` field — its lifetime marker is
    // `capturedAt`. Same semantics, different column.
    expect(screenshots.where).toEqual({ capturedAt: { gt: new Date(cursor) } });
    const pins = screenshots.include.pins;
    expect(pins.where).toEqual({ updatedAt: { gt: new Date(cursor) } });
    const comments = pins.include.comments;
    expect(comments.where).toEqual({ updatedAt: { gt: new Date(cursor) } });
  });

  it('empty delta returns []', async () => {
    mocks.project.findMany.mockResolvedValue([]);
    const res = await GET(getReq('?since=2026-06-15T12:00:00.000Z'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('falls back to the full tree when since is an unparseable string', async () => {
    // A malformed cursor must NOT brick the dashboard. The route
    // detects Number.isNaN and skips the filter, returning the legacy
    // unfiltered tree.
    mocks.project.findMany.mockResolvedValue(fullTree);
    const res = await GET(getReq('?since=not-a-date'));
    expect(res.status).toBe(200);
    // F9's team-scope filter is still applied (security: callers
    // always see only their own teams), but the since filter is
    // skipped because the cursor is unparseable. The where shape
    // is { AND: [teamScope] } with no since filter inside.
    const call = mocks.project.findMany.mock.calls[0][0];
    expect(call.where.AND).toHaveLength(1);
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const req = new NextRequest('https://markup.ashbi.ca/api/projects?since=2026-06-15T12:00:00.000Z', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(mocks.project.findMany).not.toHaveBeenCalled();
  });
});
