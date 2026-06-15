// Integration tests for the screenshot id validation on the recapture +
// status routes.
//
// Security context: both POST /api/screenshots/[id]/recapture and
// GET /api/screenshots/[id]/status previously had no input validation
// on the [id] path parameter. They would happily forward arbitrary
// strings into Prisma's `where: { id }` query, which throws on
// non-UUID input — surfacing as 500. That had two consequences:
//
// 1. Garbage input hit the rate-limit bucket first, draining legitimate
//    operator capacity (audit F3).
// 2. Clients saw a 500 for what is really a client-side error — should
//    be a 400 with a clear error message.
//
// The fix: validate `id` against the UUID shape *before* the rate limit
// (in recapture) and before the DB read (in status), returning 400 on
// a non-UUID. These tests pin both behaviours.
//
// Constraint: validation MUST run before the rate limit. We assert that
// by checking the rate-limit mock is never called for a non-UUID id on
// the recapture route.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consume: vi.fn().mockReturnValue({ ok: true, remaining: 5 }),
  spawn: vi.fn(),
  audit: vi.fn(),
  screenshot: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: mocks.consume,
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

// Fake child for the recapture route — never actually invoked on a
// 400 path, but the route's import of child_process still has to
// resolve, and tests that DO reach the spawn path need a real handle.
function makeFakeChild() {
  const { Readable } = require('node:stream') as typeof import('node:stream');
  const stderr = new Readable({ read() {} });
  const child: any = {
    pid: 1,
    stdout: new Readable({ read() {} }),
    stderr,
    on() { return child; },
    unref: vi.fn(),
  };
  return child;
}

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => {
    mocks.spawn(...args);
    return makeFakeChild();
  },
}));

import { POST as RECAPTURE } from '../../src/app/api/screenshots/[id]/recapture/route';
import { GET as STATUS } from '../../src/app/api/screenshots/[id]/status/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockReturnValue({ ok: true, remaining: 5 });
  mocks.screenshot.findUnique.mockResolvedValue({
    width: 1280,
    height: 720,
    capturedAt: new Date('2026-06-14T15:00:00.000Z'),
  });
});

describe('POST /api/screenshots/[id]/recapture — id validation', () => {
  it('returns 400 on a non-UUID id (NOT 500)', async () => {
    const res = await RECAPTURE(
      new Request('https://markup.ashbi.ca/api/screenshots/not-a-uuid/recapture', {
        method: 'POST',
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/uuid/i);
    // The DB must NOT be hit on a bad id (the old code would forward
    // 'not-a-uuid' to Prisma and crash with a 500).
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
    // The child process must NOT be spawned.
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does NOT consume a rate-limit token on a non-UUID id', async () => {
    // Audit F3: validation must run BEFORE the rate limit, otherwise
    // a hostile client can drain the operator's bucket with garbage
    // requests. Assert no consume() call on a bad id.
    const res = await RECAPTURE(
      new Request('https://markup.ashbi.ca/api/screenshots/garbage/recapture', {
        method: 'POST',
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: 'garbage' }) }
    );
    expect(res.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});

describe('GET /api/screenshots/[id]/status — id validation', () => {
  it('returns 400 on a non-UUID id (NOT 500)', async () => {
    const res = await STATUS(
      new Request('https://markup.ashbi.ca/api/screenshots/not-a-uuid/status', {
        method: 'GET',
        headers: { origin: 'https://markup.ashbi.ca' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/uuid/i);
    // The DB must NOT be hit on a bad id.
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 with a UUID-shaped error string on a SQL-injection-style id', async () => {
    // Belt-and-suspenders: a hostile caller that tries to inject SQL
    // via the path segment should be caught by the UUID regex, not
    // forwarded to the DB.
    const res = await STATUS(
      new Request(
        "https://markup.ashbi.ca/api/screenshots/x%27%20OR%20%271%27%3D%271/status",
        {
          method: 'GET',
          headers: { origin: 'https://markup.ashbi.ca' },
        }
      ),
      { params: Promise.resolve({ id: "x' OR '1'='1" }) }
    );
    expect(res.status).toBe(400);
    expect(mocks.screenshot.findUnique).not.toHaveBeenCalled();
  });
});
