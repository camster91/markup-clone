// Unit tests for the rate-limit keying in
// src/app/api/screenshots/[id]/recapture/route.ts.
//
// The recapture rate limiter was previously a single bucket
// `${origin}:${id}`, which conflated per-screenshot and per-origin
// throttling. One operator clicking Recapture on many stuck screenshots
// would end up throttled on every other screenshot for the same origin.
// The fix splits into two buckets so a busy operator doesn't get
// self-throttled across the dashboard.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consume: vi.fn().mockReturnValue({ ok: true, remaining: 5 }),
  spawn: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    screenshot: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: mocks.consume,
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

// Mock child_process.spawn with a fake child that exposes the same API
// surface (stdout/stderr streams, 'exit' and 'error' events, pid, unref).
//
// The real route attaches its 'data' and 'exit' listeners synchronously
// after `spawn()` returns. To simulate that we have to schedule the
// stderr/end events on the next event-loop tick, AFTER the listeners are
// attached. queueMicrotask + setTimeout(0) is the simplest pattern that
// runs after the route's synchronous listener-attachment code completes.
function makeFakeChild(pid: number, opts: {
  exitCode?: number; signal?: NodeJS.Signals; stderr?: string;
  spawnError?: Error;
}) {
  const { Readable } = require('node:stream') as typeof import('node:stream');
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const handlers: Record<string, Array<(...args: any[]) => void>> = {
    exit: [],
    error: [],
  };
  const child: any = {
    pid,
    stdout,
    stderr,
    on(event: string, cb: (...args: any[]) => void) {
      (handlers[event] ||= []).push(cb);
      return child;
    },
    unref: vi.fn(),
  };
  if (opts.spawnError) {
    setImmediate(() => (handlers.error || []).forEach((cb) => cb(opts.spawnError)));
    return child;
  }
  setImmediate(() => {
    if (opts.stderr) {
      stderr.push(Buffer.from(opts.stderr));
    }
    (handlers.exit || []).forEach((cb) => cb(opts.exitCode ?? 0, opts.signal ?? null));
  });
  return child;
}

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mocks.spawn(...args),
}));

// Auth: by default the route's requireDashboardOrigin is satisfied (the
// test sends an Origin: https://markup.ashbi.ca header). The auth function
// is real (not mocked) so we exercise it in the test, not stub it.

import { POST } from '../../src/app/api/screenshots/[id]/recapture/route';

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.consume.mockReturnValue({ ok: true, remaining: 5 });
  // Default: a successful spawn that exits 0. The exit event fires on
  // the next microtask, by which time the route has already returned
  // its 200 response, so the audit('ok') call is observable from the
  // test (we wait a tick before asserting).
  mocks.spawn.mockImplementation(() => makeFakeChild(1234, { exitCode: 0 }));
  await import('@/lib/prisma').then(({ prisma }) => {
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

describe('POST /api/screenshots/[id]/recapture — spawn + audit', () => {
  it('spawns bash with the bind-mount script path and the screenshot id', async () => {
    const res = await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-spawn-1' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args).toEqual(['/opt/app-scripts/recapture.sh', 'ss-spawn-1']);
    expect(opts).toMatchObject({ detached: true });
    // stdio must be [ignore, pipe, pipe] so we can capture stderr.
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('records an audit entry with status=ok when the script exits 0', async () => {
    mocks.spawn.mockImplementation(() => makeFakeChild(42, { exitCode: 0 }));
    mocks.audit.mockClear();
    await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-audit-ok' }),
    });
    // The exit event fires on setImmediate; wait two ticks.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.audit).toHaveBeenCalled();
    const call = mocks.audit.mock.calls.find((c) =>
      (c[0] as any)?.action === 'screenshot.recapture' && (c[0] as any)?.target === 'ss-audit-ok'
    );
    expect(call).toBeDefined();
    expect((call![0] as any).metadata).toMatchObject({ status: 'ok', pid: 42 });
  });

  it('records an audit entry with stderr when the script exits non-zero', async () => {
    mocks.spawn.mockImplementation(() => makeFakeChild(99, {
      exitCode: 2,
      stderr: 'No chromium binary found on PATH\n',
    }));
    mocks.audit.mockClear();
    await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-audit-fail' }),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.audit).toHaveBeenCalled();
    const call = mocks.audit.mock.calls.find((c) =>
      (c[0] as any)?.action === 'screenshot.recapture' && (c[0] as any)?.target === 'ss-audit-fail'
    );
    expect(call).toBeDefined();
    expect((call![0] as any).metadata).toMatchObject({
      status: 'failed',
      code: 2,
      stderr: expect.stringContaining('No chromium'),
    });
  });

  it('records an audit entry on spawn error', async () => {
    mocks.spawn.mockImplementation(() => makeFakeChild(0, {
      spawnError: Object.assign(new Error('ENOENT: no such file or directory, spawn bash'), { code: 'ENOENT' }),
    }));
    mocks.audit.mockClear();
    await POST(makeReq({ origin: 'https://markup.ashbi.ca' }), {
      params: Promise.resolve({ id: 'ss-spawn-err' }),
    });
    await new Promise((r) => setTimeout(r, 20));
    const call = mocks.audit.mock.calls.find((c) =>
      (c[0] as any)?.action === 'screenshot.recapture' && (c[0] as any)?.target === 'ss-spawn-err'
    );
    expect(call).toBeDefined();
    expect((call![0] as any).metadata).toMatchObject({ status: 'spawn_error' });
  });
});
