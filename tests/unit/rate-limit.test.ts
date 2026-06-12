/**
 * Unit tests for src/lib/rate-limit.ts
 *
 * Structure:
 * - Simple refillRate=0 tests: resetModules between tests, no fake timers
 * - Time-advance tests: use vi.useFakeTimers + vi.setSystemTime BEFORE import,
 *   keep module loaded, advance with vi.setSystemTime (no resetModules)
 * - Cleanup tests: set fake time, import, advance time, call _triggerCleanup()
 *
 * afterEach always calls vi.useRealTimers() to reset timer state.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

// ─── refillRate=0: simple token counting ──────────────────────────────────────

describe('consume — allows up to N requests, blocks the (N+1)th', () => {
  it('blocks on the 6th request with maxTokens=5, refillRate=0', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    const opts = { maxTokens: 5, refillRate: 0 };
    for (let i = 0; i < 5; i++) {
      const r = consume('key', opts);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
    const r = consume('key', opts);
    expect(r.ok).toBe(false);
    expect(typeof r.retryAfterSec).toBe('number');
  });

  it('blocks on the 31st request with maxTokens=30, refillRate=0', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    const opts = { maxTokens: 30, refillRate: 0 };
    for (let i = 0; i < 30; i++) {
      expect(consume('key', opts).ok).toBe(true);
    }
    expect(consume('key', opts).ok).toBe(false);
  });
});

describe('consume — different keys have separate buckets', () => {
  it('exhausting one key does not affect another', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    consume('key-a', { maxTokens: 1, refillRate: 0 });
    consume('key-a', { maxTokens: 1, refillRate: 0 }); // blocked
    const r = consume('key-b', { maxTokens: 1, refillRate: 0 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('three independent buckets at different fill levels', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    consume('a', { maxTokens: 2, refillRate: 0 });
    consume('a', { maxTokens: 2, refillRate: 0 }); // blocked
    consume('b', { maxTokens: 3, refillRate: 0 });
    consume('b', { maxTokens: 3, refillRate: 0 }); // blocked
    consume('b', { maxTokens: 3, refillRate: 0 }); // blocked

    expect(consume('a', { maxTokens: 2, refillRate: 0 }).ok).toBe(false);
    expect(consume('b', { maxTokens: 3, refillRate: 0 }).ok).toBe(false);

    // c is still untouched
    const c = consume('c', { maxTokens: 2, refillRate: 0 });
    expect(c.ok).toBe(true);
    expect(c.remaining).toBe(1);
  });
});

describe('consume — retryAfterSec is correctly computed', () => {
  it('retryAfterSec = 2 when bucket is empty and refillRate=0.5', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    consume('key', { maxTokens: 1, refillRate: 0.5 });
    const r = consume('key', { maxTokens: 1, refillRate: 0.5 });
    expect(r.ok).toBe(false);
    // (1 - 0) / 0.5 = 2 seconds → ceil = 2
    expect(r.retryAfterSec).toBe(2);
  });

  it('retryAfterSec = 10 when refillRate=0.1 (1 token every 10s)', async () => {
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');
    consume('key', { maxTokens: 1, refillRate: 0.1 });
    const r = consume('key', { maxTokens: 1, refillRate: 0.1 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(10);
  });
});

// ─── Time-advance tests: setSystemTime BEFORE import, no resetModules ─────────

describe('consume — after waiting, the bucket refills', () => {
  it('refills one token after 2 seconds at 0.5 tokens/sec', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(0));
    vi.resetModules(); // clean module state; setInterval now faked
    const { consume } = await import('@/lib/rate-limit');

    // Exhaust the single-token bucket
    consume('key', { maxTokens: 1, refillRate: 0 });
    expect(consume('key', { maxTokens: 1, refillRate: 0 }).ok).toBe(false);

    // Advance fake clock to t=2s
    vi.setSystemTime(new Date(2000));

    const r = consume('key', { maxTokens: 1, refillRate: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('refills 0.5 tokens after 1 second at 0.5 tokens/sec', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(0));
    vi.resetModules();
    const { consume } = await import('@/lib/rate-limit');

    // Consume at t=0 — tokens: 1→0
    consume('key', { maxTokens: 1, refillRate: 0.5 });

    // Advance to t=1s — 0.5 tokens refill, still < 1
    vi.setSystemTime(new Date(1000));

    const r = consume('key', { maxTokens: 1, refillRate: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(1); // need 1s more for full token
  });
});

// ─── Cleanup tests ─────────────────────────────────────────────────────────────

describe('consume — memory cleanup for old buckets', () => {
  it('buckets untouched for >5 minutes are removed by _triggerCleanup', async () => {
    // Set fake time BEFORE importing so bucket.lastRefill uses the fake clock
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(0));
    vi.resetModules();
    const { consume, _bucketCount, _triggerCleanup } = await import('@/lib/rate-limit');

    // Create bucket at t=0
    consume('stale-key', { maxTokens: 1, refillRate: 0 });
    expect(_bucketCount()).toBe(1);

    // Advance fake clock to t=6min
    vi.setSystemTime(new Date(6 * 60 * 1000));

    // Trigger cleanup — bucket (lastRefill=0, age=360000ms) > 300000ms threshold
    _triggerCleanup();

    expect(_bucketCount()).toBe(0);
  });

  it('a fresh bucket survives the cleanup at exactly 5 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(0));
    vi.resetModules();
    const { consume, _bucketCount, _triggerCleanup } = await import('@/lib/rate-limit');

    consume('fresh-key', { maxTokens: 1, refillRate: 0 });
    expect(_bucketCount()).toBe(1);

    // Advance to exactly 5 minutes — bucket age = 300000ms
    // 300000 > 300000 is FALSE → survives
    vi.setSystemTime(new Date(5 * 60 * 1000));
    _triggerCleanup();
    expect(_bucketCount()).toBe(1);

    // Advance 1ms past threshold — now strictly greater → removed
    vi.setSystemTime(new Date(5 * 60 * 1000 + 1));
    _triggerCleanup();
    expect(_bucketCount()).toBe(0);
  });
});
