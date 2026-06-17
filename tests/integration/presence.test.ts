// Integration tests for the /api/presence route — multi-user
// collaboration (collab card).
//
// Three behaviours pinned down here:
//
//   1) POST creates/upserts a row. The route uses an upsert keyed on
//      (userId, projectId) so a second POST from the same user bumps
//      lastSeenAt + overwrites the cursor, not create a duplicate row.
//
//   2) GET returns rows for the project whose lastSeenAt > since.
//      The 60s TTL is the implicit floor when `since` is missing or
//      older than 60s — matches the dashboard's "online" definition.
//
//   3) Stale presences (lastSeenAt older than 60s) are excluded from
//      the GET response even if the client passes a much older cursor.
//
// Prisma is mocked at the module level so we can inspect the
// upsert/findMany calls. The route's full DB plumbing is exercised
// end-to-end: it parses the body, validates it, calls the prisma
// client, and returns the right status.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  presence: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

import { GET, POST } from '../../src/app/api/presence/route';
import { NextRequest } from 'next/server';

const ORIGIN = 'https://markup.ashbi.ca';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SCREENSHOT_ID = '33333333-3333-3333-3333-333333333333';

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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
  // Default upsert mock: return a row that looks like the one we
  // would have stored. The route's POST echoes this back to the
  // client, so we use it to assert the upsert was called with the
  // right fields.
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
    const res = await POST(postReq({ projectId: PROJECT_ID, userId: USER_ID }));
    expect(res.status).toBe(401);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('creates a new row on first heartbeat (no cursor, no screenshot)', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: USER_ID },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presence).toBeDefined();
    expect(body.presence.userId).toBe(USER_ID);
    expect(body.presence.projectId).toBe(PROJECT_ID);
    // The cursor fields are null (no cursor) on a heartbeat that
    // doesn't include them.
    expect(body.presence.cursorX).toBeNull();
    expect(body.presence.cursorY).toBeNull();
    expect(body.presence.screenshotId).toBeNull();

    // The upsert must be keyed on (userId, projectId) — this is
    // what makes the second heartbeat a no-op overwrite rather than
    // a duplicate row. The unique index is on (userId, projectId),
    // and Prisma names the compound key `userId_projectId` for the
    // where: clause shape.
    expect(mocks.presence.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_projectId: { userId: USER_ID, projectId: PROJECT_ID } });
    expect(call.create.userId).toBe(USER_ID);
    expect(call.create.projectId).toBe(PROJECT_ID);
  });

  it('upserts with cursor + screenshotId when the client provides them', async () => {
    const res = await POST(postReq(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
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
    // The update branch also carries the latest values so a second
    // POST overwrites the previous cursor (not just bumps lastSeenAt).
    expect(call.update.screenshotId).toBe(SCREENSHOT_ID);
    expect(call.update.cursorX).toBe(42.5);
    expect(call.update.cursorY).toBe(17.3);
    // lastSeenAt is bumped on every heartbeat — must be a Date.
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    expect(call.create.lastSeenAt).toBeInstanceOf(Date);
  });

  it('accepts cursorX/cursorY = 0 (a "top-left cursor" is a real value, not falsy)', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: USER_ID, cursorX: 0, cursorY: 0 },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(200);
    const call = mocks.presence.upsert.mock.calls[0][0];
    expect(call.create.cursorX).toBe(0);
    expect(call.create.cursorY).toBe(0);
  });

  it('rejects a missing projectId with 400', async () => {
    const res = await POST(postReq({ userId: USER_ID }, { origin: ORIGIN }));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed projectId with 400', async () => {
    const res = await POST(postReq(
      { projectId: 'not-a-uuid', userId: USER_ID },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a missing userId with 400', async () => {
    const res = await POST(postReq({ projectId: PROJECT_ID }, { origin: ORIGIN }));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed userId with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: 'x' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects cursorX out of [0, 100] with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: USER_ID, cursorX: 150 },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects cursorY = NaN with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: USER_ID, cursorY: 'not-a-number' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed screenshotId with 400', async () => {
    const res = await POST(postReq(
      { projectId: PROJECT_ID, userId: USER_ID, screenshotId: 'nope' },
      { origin: ORIGIN }
    ));
    expect(res.status).toBe(400);
    expect(mocks.presence.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON body with 400', async () => {
    const res = await POST(new NextRequest('https://markup.ashbi.ca/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: ORIGIN },
      body: 'not-json',
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
    expect(mocks.presence.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed projectId with 400', async () => {
    const res = await GET(getReq('?projectId=oops', { origin: ORIGIN }));
    expect(res.status).toBe(400);
    expect(mocks.presence.findMany).not.toHaveBeenCalled();
  });

  it('without a since cursor, uses the 60s TTL as the implicit floor', async () => {
    const res = await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect(call.where.projectId).toBe(PROJECT_ID);
    // The floor must be roughly 60s ago. Allow a small drift to
    // account for the time between constructing the Date and the
    // mock inspecting it.
    const floor = call.where.lastSeenAt.gt as Date;
    const now = Date.now();
    const age = now - floor.getTime();
    expect(age).toBeGreaterThanOrEqual(59_000);
    expect(age).toBeLessThanOrEqual(61_000);
  });

  it('with a recent since cursor, passes it through (delta window)', async () => {
    const cursor = new Date(Date.now() - 5_000).toISOString();
    const res = await GET(getReq(`?projectId=${PROJECT_ID}&since=${encodeURIComponent(cursor)}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect((call.where.lastSeenAt.gt as Date).toISOString()).toBe(cursor);
  });

  it('clamps a stale since cursor to the 60s TTL (online definition)', async () => {
    // Client passed a cursor from 10 minutes ago. The route clamps
    // it to (now - 60s) so the "online" list only shows reviewers
    // active in the last minute.
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await GET(getReq(`?projectId=${PROJECT_ID}&since=${encodeURIComponent(stale)}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    const floor = call.where.lastSeenAt.gt as Date;
    const age = Date.now() - floor.getTime();
    expect(age).toBeLessThanOrEqual(61_000);
    expect(age).toBeGreaterThanOrEqual(59_000);
  });

  it('falls back to the 60s TTL when since is an unparseable string', async () => {
    const res = await GET(getReq(`?projectId=${PROJECT_ID}&since=garbage`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    const floor = call.where.lastSeenAt.gt as Date;
    const age = Date.now() - floor.getTime();
    expect(age).toBeGreaterThanOrEqual(59_000);
    expect(age).toBeLessThanOrEqual(61_000);
  });

  it('returns rows for the project within the since window (the dashboard "online" list)', async () => {
    // Three reviewers: two fresh, one stale. The route's where
    // clause excludes the stale one before the DB returns, so the
    // mock only sees the fresh ones. The list comes back as
    // { presences, since }.
    const fresh1 = { id: 'p-1', userId: 'u-1', projectId: PROJECT_ID, lastSeenAt: new Date() };
    const fresh2 = { id: 'p-2', userId: 'u-2', projectId: PROJECT_ID, lastSeenAt: new Date() };
    mocks.presence.findMany.mockResolvedValue([fresh1, fresh2]);

    const res = await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presences).toHaveLength(2);
    expect(body.presences[0].userId).toBe('u-1');
    expect(body.presences[1].userId).toBe('u-2');
    // The response includes the resolved `since` so the client can
    // use it as the cursor on the next poll (avoids passing an
    // epoch-relative timestamp that has since aged out).
    expect(typeof body.since).toBe('string');
  });

  it('orders results by lastSeenAt desc (most recent first)', async () => {
    const res = await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ lastSeenAt: 'desc' });
  });

  it('stale presences (lastSeenAt older than 60s) are excluded by the where clause', async () => {
    // The route's `where: { lastSeenAt: { gt: <now - 60s> } }` is
    // what filters stale rows server-side. We assert the floor is
    // at or after (now - 60s); the actual filtering is then the
    // DB's job, but the contract (a stale row cannot pass the
    // route's gate) is verified by the bounds check.
    const res = await GET(getReq(`?projectId=${PROJECT_ID}`, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    const call = mocks.presence.findMany.mock.calls[0][0];
    const floor = call.where.lastSeenAt.gt as Date;
    // Anything at or before this floor is "offline" and excluded.
    // The bound is strict: rows at exactly `floor` (lastSeenAt
    // == now-60s) are NOT in the response — we use `gt`, not
    // `gte`, so a reviewer whose last heartbeat was exactly 60s
    // ago drops off the list immediately.
    const offlineBound = new Date(Date.now() - 60_000);
    expect(floor.getTime()).toBeGreaterThanOrEqual(offlineBound.getTime() - 100);
    expect(floor.getTime()).toBeLessThanOrEqual(offlineBound.getTime() + 100);
  });
});
