// Integration tests for the rate limit on POST /api/pins/[id]/comments.
//
// 30 tokens / 0.5 per second = 60s sustained per (origin, pinId). The
// bucket is per (origin, pinId) so a busy reviewer on one pin does NOT
// starve the bucket for a different pin they're reviewing at the same
// time. Freeze the clock with setSystemTime so the refillRate=0.5 doesn't
// sneak tokens back in between loop iterations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetBucket } from '@/lib/rate-limit';
import { liveSessionRow } from '../helpers/dashboard-auth';

const mocks = vi.hoisted(() => ({
  comment: { create: vi.fn() },
  pin: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  session: { findUnique: vi.fn() },
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

import { POST } from '../../src/app/api/pins/[id]/comments/route';

const PIN_A = '11111111-1111-1111-1111-111111111111';
const PIN_B = '22222222-2222-2222-2222-222222222222';
const ORIGIN = 'https://markup.ashbi.ca';
const KEY_A = `comments:origin:${ORIGIN}:${PIN_A}`;
const KEY_B = `comments:origin:${ORIGIN}:${PIN_B}`;

// Test CSRF token used by the request builders. The comments
// route's `requireCsrfToken` check requires the X-CSRF-Token
// header to match the `markup.csrf` cookie.
const CSRF_TOKEN='***';

function makeReq(pinId: string, headers: Record<string, string> = {}): Request {
  // Default headers set BOTH `requireDashboardOrigin` (Origin)
  // and `requireCsrfToken` (cookie + X-CSRF-Token header).
  const baseHeaders: Record<string, string> = {
    'X-CSRF-Token': CSRF_TOKEN,
    cookie: `markup.csrf=${CSRF_TOKEN}`,
  };
  return new Request(`https://markup.ashbi.ca/api/pins/${pinId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...baseHeaders, ...headers },
    body: JSON.stringify({ text: 'hi' }),
  });
}

const params = (pinId: string) => ({ params: Promise.resolve({ id: pinId }) });

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.data.value = 'test-dashboard-session';
  mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  // Default DB behaviour: a comment row is created, the pin is not RESOLVED
  // (so we skip the reopen-on-reply update path) — that keeps each loop
  // iteration fast and the assertions on 429 straightforward.
  mocks.comment.create.mockResolvedValue({ id: 'c-1', text: 'hi' });
  mocks.pin.findUnique.mockResolvedValue({ status: 'OPEN' });
  mocks.pin.update.mockResolvedValue({ id: PIN_A, status: 'OPEN' });
});

afterEach(() => {
  // Don't leave buckets lying around for other tests in the same process.
  _resetBucket(KEY_A);
  _resetBucket(KEY_B);
  vi.useRealTimers();
});

// R0.3 closeout (A3): the comment POST route used to only do an `if (!text)`
// truthy check. That meant text of arbitrary length or with null bytes
// could reach the DB. Now the route calls validatePinText (the same
// helper as the pin-create flow), so the comment text gets the same
// 2000-char cap, trim, and null-byte rejection.
describe('POST /api/pins/[id]/comments — text validation', () => {
  it('returns 400 when text is > 2000 chars (one over the cap)', async () => {
    const res = await POST(
      new Request(`https://markup.ashbi.ca/api/pins/${PIN_A}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` },
        body: JSON.stringify({ text: 'a'.repeat(2001) }),
      }),
      params(PIN_A)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/2000/);
    // The DB must NOT be hit on bad input.
    expect(mocks.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when text contains a null byte (defense in depth)', async () => {
    const res = await POST(
      new Request(`https://markup.ashbi.ca/api/pins/${PIN_A}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` },
        body: JSON.stringify({ text: 'with\u0000null' }),
      }),
      params(PIN_A)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/null/);
    expect(mocks.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when text is empty string (after trim → empty)', async () => {
    // Replaces the old "if (!text)" check with a real length check.
    // Empty string fails the same way as whitespace-only input.
    const res = await POST(
      new Request(`https://markup.ashbi.ca/api/pins/${PIN_A}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` },
        body: JSON.stringify({ text: '   ' }),
      }),
      params(PIN_A)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty/);
    expect(mocks.comment.create).not.toHaveBeenCalled();
  });

  it('returns 201 with a valid text (sanity — happy path still works)', async () => {
    const res = await POST(
      new Request(`https://markup.ashbi.ca/api/pins/${PIN_A}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` },
        body: JSON.stringify({ text: 'looks good' }),
      }),
      params(PIN_A)
    );
    expect(res.status).toBe(201);
    expect(mocks.comment.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/pins/[id]/comments — rate limit', () => {
  it('returns 429 on the 31st call from the same origin on the same pin', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-06-14T15:00:00.000Z'));
    _resetBucket(KEY_A);

    // Calls 1-30: full bucket, each call consumes one token → all 201.
    for (let i = 0; i < 30; i++) {
      const res = await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
      expect(res.status).toBe(201);
    }
    // Call 31: bucket is empty → 429. No DB write should run.
    mocks.comment.create.mockClear();
    mocks.pin.findUnique.mockClear();
    const res31 = await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
    expect(res31.status).toBe(429);
    expect(mocks.comment.create).not.toHaveBeenCalled();
    expect(mocks.pin.findUnique).not.toHaveBeenCalled();
  });

  it('the 429 response carries a numeric Retry-After header', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-06-14T15:00:00.000Z'));
    _resetBucket(KEY_A);

    // Drain the bucket.
    for (let i = 0; i < 30; i++) {
      await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
    }
    // The 31st call must carry Retry-After in seconds (positive integer).
    // refillRate=0.5 ⇒ 1 token every 2s ⇒ retryAfterSec >= 2.
    const res = await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
  });

  it('different pins have separate rate-limit buckets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-06-14T15:00:00.000Z'));
    _resetBucket(KEY_A);
    _resetBucket(KEY_B);

    // Drain PIN_A's bucket — 30 calls all 201, 31st is 429.
    for (let i = 0; i < 30; i++) {
      const r = await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
      expect(r.status).toBe(201);
    }
    const throttled = await POST(makeReq(PIN_A, { origin: ORIGIN }), params(PIN_A));
    expect(throttled.status).toBe(429);

    // PIN_B's bucket is untouched — a full 30 calls should all 201.
    for (let i = 0; i < 30; i++) {
      const r = await POST(makeReq(PIN_B, { origin: ORIGIN }), params(PIN_B));
      expect(r.status).toBe(201);
    }
    // And the 31st on PIN_B is throttled, confirming PIN_B had its own
    // independent bucket rather than sharing PIN_A's exhausted one.
    const throttledB = await POST(makeReq(PIN_B, { origin: ORIGIN }), params(PIN_B));
    expect(throttledB.status).toBe(429);
  });
});
