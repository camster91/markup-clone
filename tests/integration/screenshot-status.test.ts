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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetBucket } from '../../src/lib/rate-limit';

const mocks = vi.hoisted(() => ({
  screenshot: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

import { GET } from '../../src/app/api/screenshots/[id]/status/route';

const FIXED_CAPTURED_AT = new Date('2026-06-14T15:00:00.000Z');
const STATUS_ORIGIN_KEY = 'status:origin:https://markup.ashbi.ca';

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
      makeReq('https://evil.example.com/api/screenshots/11111111-1111-1111-1111-111111111111/status'),
      { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) }
    );
    expect(res.status).toBe(401);
    // We must NOT have hit the DB on an unauth'd request.
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
  });

  it('happy path: returns width, height, and an ISO capturedAt', async () => {
    const res = await GET(
      makeReq('https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
    expect(body.capturedAt).toBe(FIXED_CAPTURED_AT.toISOString());
    // The query must select only the columns we actually return.
    expect(mocks.screenshot.findUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-1111-1111-111111111111' },
      select: { width: true, height: true, capturedAt: true },
    });
  });

  it('returns 304 with no body when ?since is at or after capturedAt', async () => {
    // ?since equal to capturedAt → no change → 304.
    const res = await GET(
      makeReq(
        `https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status?since=${encodeURIComponent(FIXED_CAPTURED_AT.toISOString())}`,
        { origin: 'https://markup.ashbi.ca' }
      ),
      { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) }
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
        `https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status?since=${encodeURIComponent(oldSince)}`,
        { origin: 'https://markup.ashbi.ca' }
      ),
      { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) }
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
      makeReq('https://markup.ashbi.ca/api/screenshots/22222222-2222-2222-2222-222222222222/status', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: '22222222-2222-2222-2222-222222222222' }) }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('ignores a malformed ?since and still returns the screenshot', async () => {
    // We don't want a bad client-supplied query string to break the recapture
    // poll loop. A malformed since is treated as "no since" → 200.
    const res = await GET(
      makeReq('https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status?since=not-a-date', {
        origin: 'https://markup.ashbi.ca',
      }),
      { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.width).toBe(1280);
  });
});

describe('GET /api/screenshots/[id]/status — rate limit', () => {
  // The 120/2.0 token bucket per origin must hold for the legitimate
  // 30s poll × 2 ScreenshotView instances = 4 polls/min steady state, and
  // must 429 a runaway client on the 121st call inside a one-second
  // window. Freeze the clock with setSystemTime so the refillRate=2.0
  // doesn't sneak tokens back in between loop iterations.
  beforeEach(() => {
    _resetBucket(STATUS_ORIGIN_KEY);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-06-14T15:00:00.000Z'));
  });

  afterEach(() => {
    _resetBucket(STATUS_ORIGIN_KEY);
    vi.useRealTimers();
  });

  it('returns 429 on the 121st call from the same origin within a 60s window', async () => {
    const req = (): Request => makeReq(
      'https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status',
      { origin: 'https://markup.ashbi.ca' }
    );
    const params = { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) };

    // Calls 1-120: full bucket, each call consumes one token → all 200.
    for (let i = 0; i < 120; i++) {
      const res = await GET(req(), params);
      expect(res.status).toBe(200);
    }
    // Call 121: bucket is empty → 429. No DB query should run.
    mocks.screenshot.findUnique.mockClear();
    const res121 = await GET(req(), params);
    expect(res121.status).toBe(429);
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
  });

  it('the 429 response carries a numeric Retry-After header', async () => {
    const req = (): Request => makeReq(
      'https://markup.ashbi.ca/api/screenshots/11111111-1111-1111-1111-111111111111/status',
      { origin: 'https://markup.ashbi.ca' }
    );
    const params = { params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }) };

    // Drain the bucket.
    for (let i = 0; i < 120; i++) {
      await GET(req(), params);
    }
    // The 121st call must carry Retry-After in seconds (positive integer).
    const res = await GET(req(), params);
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
  });
});
