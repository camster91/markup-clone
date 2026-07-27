// Integration tests for the /api/presence route — multi-user
// collaboration (collab card).
//
// Three behaviours pinned down here:
//
//   1) POST creates/upserts a row. Identity comes from the session
//      (requireAuth); client-supplied userId is ignored.
//
//   2) GET returns rows for the project whose lastSeenAt > since.
//      The 60s TTL is the implicit floor when `since` is missing or
//      older than 60s — matches the dashboard's "online" definition.
//
//   3) Stale presences (lastSeenAt older than 60s) are excluded from
//      the GET response even if the client passes a much older cursor.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const USER_ID = '22222222-2222-2222-2222-222222222222';

const mocks = vi.hoisted(() => ({
  presence: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

// Session identity for POST — requireDashboardAuth is stubbed in
// setup.ts (origin-only); requireAuth must still resolve a user.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/auth')>();
  return {
    ...actual,
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
    requireAuth: vi.fn(async () => ({
      id: '22222222-2222-2222-2222-222222222222',
      email: 'op@example.com',
      role: 'operator',
    })),
  };
});

import { GET, POST } from '../../src/app/api/presence/route';
import { NextRequest } from 'next/server';

const ORIGIN = 'https://markup.ashbi.ca';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const SCREENSHOT_ID = '33333333-3333-3333-3333-333333333333';
const CSRF_TOKEN = 'test-csrf-token';

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/presence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function getReq(qs: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/presence${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.presence.upsert.mockImplementation(async ({ create }: any) => ({
    id: 'presence-1',
    userId: create.userId,
    projectId: create.projectId,
    screenshotId: create.screenshotId,
    cursorX: create.cursorX,
    cursorY: create.cursorY,
    lastSeenAt: create.lastSeenAt,
  }));
  mocks.presence.findMany.mockResolvedValue([]);
});

describe('POST /api/presence — heartbeat', () => {
  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await POST(postReq({ projectId: PROJECT_ID }));
    expect(res.status).toBe(401);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('creates a new row on first heartbeat (no cursor, no screenshot)', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presence).toBeDefined();
    expect(body.presence.userId).toBe(USER_ID);
    expect(body.presence.projectId).toBe(PROJECT_ID);
    expect(body.presence.cursorX).toBeNull();
    expect(body.presence.cursorY).toBeNull();
    expect(body.presence.screenshotId).toBeNull();

    expect(mocks.presence.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_projectId: { userId: USER_ID, projectId: PROJECT_ID } });
    expect(call.create.userId).toBe(USER_ID);
    expect(call.create.projectId).toBe(PROJECT_ID);
  });

  it('ignores a client-supplied userId (identity is session-derived)', async () => {
    const spoofed = '99999999-9999-9999-9999-999999999999';
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: spoofed },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.create.userId).toBe(USER_ID);
    expect(call.create.userId).not.toBe(spoofed);
  });

  it('upserts with cursor + screenshotId when the client provides them', async () => {
    const res = await POST(postReq(
      {
        projectId: PROJECT_ID,
        screenshotId: SCREENSHOT_ID,
        cursorX: 42.5,
        cursorY: 17.3,
      },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.create.screenshotId).toBe(SCREENSHOT_ID);
    expect(call.create.cursorX).toBe(42.5);
    expect(call.create.cursorY).toBe(17.3);
    expect(call.update.screenshotId).toBe(SCREENSHOT_ID);
    expect(call.update.cursorX).toBe(42.5);
    expect(call.update.cursorY).toBe(17.3);
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    expect(call.create.lastSeenAt).toBeInstanceOf(Date);
  });

  it('accepts cursorX/cursorY = 0 (a "top-left cursor" is a real value, not falsy)', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, cursorX: 0, cursorY: 0 },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.create.cursorX).toBe(0);
    expect(call.create.cursorY).toBe(0);
  });

  it('rejects a missing projectId with 400', async () => {
    const res = await POST(postReq({}, { origin: ORIGIN }));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed projectId with 400', async () => {
    const res = await POST(postReq(
      { projectId: 'not-a-uuid' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects cursorX out of [0, 100] with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, cursorX: 150 },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects cursorY = NaN with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, cursorY: 'not-a-number' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed screenshotId with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, screenshotId: 'bad' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON body with 400', async () => {
    const res = await POST(new NextRequest('https://markup.ashbi.ca/api/presence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: ORIGIN,
        'X-CSRF-Token': CSRF_TOKEN,
        cookie: `markup.csrf=${CSRF_TOKEN}`,
      },
      body: '{not-json',
    }));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/presence — list online', () => {
  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await GET(getReq(`?projectId=${PROJECT_ID}`));
    expect(res.status).toBe(401);
    expect(mocks.presence.findMany).not.toHaveBeenCalled();
  });

  it('rejects a missing projectId with 400', async () => {
    const res = await GET(getReq('', { origin: ORIGIN }));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed projectId with 400', async () => {
    const res = await GET(getReq('?projectId=not-a-uuid', { origin: ORIGIN }));
    expect(res.status).toBe(400);
  });

  it('without a since cursor, uses the 60s TTL as the implicit floor', async () => {
    const before = Date.now();
    await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    const after = Date.now();
    const call = mocks.presence.findMany.mock.calls[0][0];
    const since: Date = call.where.lastSeenAt.gt;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 60_000 + 50);
  });

  it('with a recent since cursor, passes it through (delta window)', async () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    await GET(getReq(`?projectId=${PROJECT_ID}&since=${encodeURIComponent(recent)}`, { origin: ORIGIN }));
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect(call.where.lastSeenAt.gt.toISOString()).toBe(recent);
  });

  it('clamps a stale since cursor to the 60s TTL (online definition)', async () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const before = Date.now();
    await GET(getReq(`?projectId=${PROJECT_ID}&since=${encodeURIComponent(stale)}`, { origin: ORIGIN }));
    const after = Date.now();
    const call = mocks.presence.findMany.mock.calls[0][0];
    const since: Date = call.where.lastSeenAt.gt;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 60_000 + 50);
  });

  it('falls back to the 60s TTL when since is an unparseable string', async () => {
    const before = Date.now();
    await GET(getReq(`?projectId=${PROJECT_ID}&since=not-a-date`, { origin: ORIGIN }));
    const after = Date.now();
    const call = mocks.presence.findMany.mock.calls[0][0];
    const since: Date = call.where.lastSeenAt.gt;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 60_000 + 50);
  });

  it('returns rows for the project within the since window (the dashboard "online" list)', async () => {
    const row = {
      id: 'p1',
      userId: USER_ID,
      projectId: PROJECT_ID,
      lastSeenAt: new Date(),
      cursorX: null,
      cursorY: null,
      screenshotId: null,
    };
    mocks.presence.findMany.mockResolvedValue([row]);
    const res = await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presences).toEqual([
      { ...row, lastSeenAt: row.lastSeenAt.toISOString() },
    ]);
    expect(typeof body.since).toBe('string');
  });

  it('orders results by lastSeenAt desc (most recent first)', async () => {
    await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ lastSeenAt: 'desc' });
  });

  it('stale presences (lastSeenAt older than 60s) are excluded by the where clause', async () => {
    await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect(call.where.projectId).toBe(PROJECT_ID);
    expect(call.where.lastSeenAt.gt).toBeInstanceOf(Date);
  });
});
