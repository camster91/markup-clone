// Integration tests for the rate limit on POST /api/pins/[id]/comments.
//
// 30 tokens / 0.5 per second = 60s sustained per (origin, pinId). The
// bucket is per (origin, pinId) so a busy reviewer on one pin does NOT
// starve the bucket for a different pin they're reviewing at the same
// time. Freeze the clock with setSystemTime so the refillRate=0.5 doesn't
// sneak tokens back in between loop iterations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetBucket } from '@/lib/rate-limit';

const mocks = vi.hoisted(() => ({
  comment: { create: vi.fn() },
  pin: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

import { POST } from '../../src/app/api/pins/[id]/comments/route';

const PIN_A = '11111111-1111-1111-1111-111111111111';
const PIN_B = '22222222-2222-2222-2222-222222222222';
const ORIGIN = 'https://markup.ashbi.ca';
const KEY_A = `comments:origin:${ORIGIN}:${PIN_A}`;
const KEY_B = `comments:origin:${ORIGIN}:${PIN_B}`;

function makeReq(pinId: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${pinId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ text: 'hi' }),
  });
}

const params = (pinId: string) => ({ params: Promise.resolve({ id: pinId }) });

beforeEach(() => {
  vi.clearAllMocks();
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
