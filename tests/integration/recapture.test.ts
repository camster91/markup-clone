// Unit tests for the rate-limit keying in
// src/app/api/screenshots/[id]/recapture/route.ts.
//
// The recapture rate limiter was previously a single bucket
// `${origin}:${id}`, which conflated per-screenshot and per-origin
// throttling. One operator clicking Recapture on one stuck screenshot
// would end up throttled on every other screenshot for the same origin.
// The fix splits into two buckets so a busy operator doesn't get
// self-throttled across the dashboard.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consume: vi.fn().mockReturnValue({ ok: true, remaining: 5 }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    screenshot: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: mocks.consume,
}));

// Auth: by default the route's requireDashboardOrigin is satisfied (the
// test sends an Origin: https://markup.ashbi.ca header). The auth function
// is real (not mocked) so we exercise it in the test, not stub it.

import { POST } from '../../src/app/api/screenshots/[id]/recapture/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockReturnValue({ ok: true, remaining: 5 });
  // The route imports prisma at the top of its module; the mock is wired
  // through vi.mock. We just need to set the screenshot.findUnique return
  // value here. Reach the mocked prisma via the consume module's
  // vi.hoisted shared state — but the cleanest path is to re-mock through
  // the module loader: the route has already imported prisma, so we can
  // reach it through the route's own reference. We use the public
  // dynamic-import path to keep the @-alias working.
  return import('@/lib/prisma').then(({ prisma }) => {
    (prisma.screenshot.findUnique as any).mockResolvedValue({ id: 'ss-1' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('https://markup.ashbi.ca/api/screenshots/ss-1/recapture', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/screenshots/[id]/recapture — rate limit keying', () => {
  it('uses two distinct keys: per-screenshot and per-origin', async () => {
    await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-1' }),
    });
    // Two consume() calls per request — one for the per-screenshot bucket,
    // one for the per-origin bucket.
    expect(mocks.consume).toHaveBeenCalledTimes(2);
    const keys = mocks.consume.mock.calls.map((c) => c[0]);
    expect(keys).toContain('recapture:shot:ss-1');
    expect(keys).toContain('recapture:origin:https://markup.ashbi.ca');
  });

  it('returns 429 with retryAfterSec when the per-screenshot bucket is empty', async () => {
    // First call (per-screenshot) returns !ok; the second call (per-origin)
    // should never be reached.
    mocks.consume.mockImplementation((key: string) => {
      if (key.startsWith('recapture:shot:')) {
        return { ok: false, retryAfterSec: 7 };
      }
      return { ok: true, remaining: 5 };
    });
    const res = await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-1' }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Too many recaptures on this screenshot/i);
    expect(body.retryAfterSec).toBe(7);
    expect(res.headers.get('Retry-After')).toBe('7');
  });

  it('returns 429 with retryAfterSec when the per-origin bucket is empty', async () => {
    mocks.consume.mockImplementation((key: string) => {
      if (key.startsWith('recapture:origin:')) {
        return { ok: false, retryAfterSec: 2 };
      }
      return { ok: true, remaining: 3 };
    });
    const res = await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-1' }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Too many recaptures from this dashboard session/i);
    expect(body.retryAfterSec).toBe(2);
  });

  it('recapture on a different screenshotId is a separate bucket', async () => {
    // Burn through 3 tokens on ss-1.
    mocks.consume.mockImplementation((key: string) => {
      if (key === 'recapture:shot:ss-1') return { ok: false, retryAfterSec: 5 };
      return { ok: true, remaining: 5 };
    });
    const r1 = await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-1' }),
    });
    expect(r1.status).toBe(429);

    // Reset the mock so ss-2 is allowed.
    mocks.consume.mockImplementation((key: string) => {
      if (key === 'recapture:shot:ss-2') return { ok: true, remaining: 2 };
      return { ok: true, remaining: 5 };
    });
    const r2 = await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-2' }),
    });
    // ss-2 should NOT inherit the throttle from ss-1.
    expect(r2.status).not.toBe(429);
  });
});
