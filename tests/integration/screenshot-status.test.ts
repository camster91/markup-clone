// Integration tests for the /api/screenshots/[id]/status route handler.
//
// This endpoint is the focused status check that ScreenshotView polls during
// a recapture. It replaces the previous /api/projects full-tree poll with a
// single-row read that returns { width, height, capturedAt }.
//
// What this catches:
// - Auth: 401 when the request is not from the dashboard origin.
// - Happy path: 200 with the right dims + ISO capturedAt.
// - 304: ?since=<capturedAt or later> returns 304 with no body, and the
//   recapture poll loop can use this as a "nothing has changed" signal.
// - 404: a bogus screenshot id returns 404.
// - 200 on a recaptured screenshot whose capturedAt is newer than `since`.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  screenshot: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

import { GET } from '../../src/app/api/screenshots/[id]/status/route';

const FIXED_CAPTURED_AT = new Date('2026-06-14T15:00:00.000Z');

function makeReq(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: screenshot exists, dims populated. Individual tests override.
  mocks.screenshot.findUnique.mockResolvedValue({
    width: 1280,
    height: 720,
    capturedAt: FIXED_CAPTURED_AT,
  });
});

describe('GET /api/screenshots/[id]/status', () => {
  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await GET(
      makeReq('https://evil.example.com/api/screenshots/ss-1/status'),
      { params: Promise.resolve({ id: 'ss-1' }) }
    );
    expect(res.status).toBe(401);
    // We must NOT have hit the DB on an unauth'd request.
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
  });

  it('happy path: returns width, height, and an ISO capturedAt', async () => {
    const res = await GET(
      makeReq('https://markup.ashbi.ca/api/screenshots/ss-1/status', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: 'ss-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
    expect(body.capturedAt).toBe(FIXED_CAPTURED_AT.toISOString());
    // The query must select only the columns we actually return.
    expect(mocks.screenshot.findUnique).toHaveBeenCalledWith({
      where: { id: 'ss-1' },
      select: { width: true, height: true, capturedAt: true },
    });
  });

  it('returns 304 with no body when ?since is at or after capturedAt', async () => {
    // ?since equal to capturedAt → no change → 304.
    const res = await GET(
      makeReq(
        `https://markup.ashbi.ca/api/screenshots/ss-1/status?since=${encodeURIComponent(FIXED_CAPTURED_AT.toISOString())}`,
        { origin: 'https://markup.ashbi.ca' }
      ),
      { params: Promise.resolve({ id: 'ss-1' }) }
    );
    expect(res.status).toBe(304);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 200 when ?since is BEFORE capturedAt (recapture has bumped capturedAt)', async () => {
    // The operator clicked Recapture a moment ago; the server has just
    // written a new PNG and bumped capturedAt. The poller's `since` is
    // stale, so the endpoint should return the new dims (200) so the
    // client can re-render with the updated image.
    const oldSince = '2026-06-14T14:55:00.000Z';
    const res = await GET(
      makeReq(
        `https://markup.ashbi.ca/api/screenshots/ss-1/status?since=${encodeURIComponent(oldSince)}`,
        { origin: 'https://markup.ashbi.ca' }
      ),
      { params: Promise.resolve({ id: 'ss-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
    expect(body.capturedAt).toBe(FIXED_CAPTURED_AT.toISOString());
  });

  it('returns 404 when the screenshot id does not exist', async () => {
    mocks.screenshot.findUnique.mockResolvedValue(null);
    const res = await GET(
      makeReq('https://markup.ashbi.ca/api/screenshots/bogus-id/status', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: 'bogus-id' }) }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('ignores a malformed ?since and still returns the screenshot', async () => {
    // We don't want a bad client-supplied query string to break the recapture
    // poll loop. A malformed since is treated as "no since" → 200.
    const res = await GET(
      makeReq('https://markup.ashbi.ca/api/screenshots/ss-1/status?since=not-a-date', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: 'ss-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.width).toBe(1280);
  });
});
