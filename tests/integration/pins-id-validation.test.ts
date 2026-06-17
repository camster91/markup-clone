// Integration tests for the pin id validation on PATCH/DELETE
// /api/pins/[id].
//
// Security context: both PATCH /api/pins/[id] and DELETE /api/pins/[id]
// previously had no input validation on the [id] path parameter. They
// would happily forward arbitrary strings into Prisma's `where: { id }`
// query, which throws on non-UUID input — surfacing as a 500 "Failed to
// update pin" / "Failed to delete pin". That had two consequences:
//
// 1. Garbage input got the same error code as a real DB outage, so the
//    operator can't tell "the dashboard is broken" from "you sent me
//    a bad id".
// 2. A burst of malformed requests would log a stack of prisma parse
//    errors and inflate the error rate.
//
// The fix: validate `id` against the UUID shape *before* the DB write,
// returning 400 with a clear error message. These tests pin both
// behaviours. The Pin model is @default(uuid()) per the Prisma schema,
// so the same UUID regex as `validateScreenshotId` applies — we just
// call it through a new `validatePinId` helper that names the field
// "pinId" in the error so the response is self-explanatory.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pin: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  screenshot: { findUnique: vi.fn(), delete: vi.fn() },
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

import { PATCH, DELETE } from '../../src/app/api/pins/[id]/route';

const ORIGIN = 'https://markup.ashbi.ca';

function patchReq(id: string, body: unknown): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

function deleteReq(id: string): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${id}`, {
    method: 'DELETE',
    headers: { origin: ORIGIN },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy path values — the validation tests below should reject
  // before any of these run, so the assertions on `.not.toHaveBeenCalled()`
  // are meaningful.
  mocks.pin.update.mockResolvedValue({ id: 'real-pin-id', status: 'OPEN' });
  mocks.pin.findUnique.mockResolvedValue({ screenshotId: 'ss-1' });
  mocks.screenshot.findUnique.mockResolvedValue({ storageKey: 'k.png' });
  mocks.pin.delete.mockResolvedValue({ id: 'real-pin-id' });
});

describe('PATCH /api/pins/[id] — id validation (R0.3 closeout A2)', () => {
  it('returns 400 on a non-UUID id (NOT 500)', async () => {
    const res = await PATCH(patchReq('not-a-uuid', { status: 'OPEN' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pinId/);
    // The DB must NOT be hit on a bad id.
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });

  it('returns 400 on a SQL-injection-style id', async () => {
    const res = await PATCH(patchReq("x' OR '1'='1", { status: 'OPEN' }),
      { params: Promise.resolve({ id: "x' OR '1'='1" }) });
    expect(res.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });

  it('returns 400 on path traversal (a common attack)', async () => {
    const res = await PATCH(patchReq('../../../etc/passwd', { status: 'OPEN' }),
      { params: Promise.resolve({ id: '../../../etc/passwd' }) });
    expect(res.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/pins/[id] — id validation (R0.3 closeout A2)', () => {
  it('returns 400 on a non-UUID id (NOT 500)', async () => {
    const res = await DELETE(deleteReq('not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pinId/);
    // The DB must NOT be hit on a bad id.
    expect(mocks.pin.findUnique).not.toHaveBeenCalled();
    expect(mocks.pin.delete).not.toHaveBeenCalled();
    // And the audit log must not be touched either (we never reached the
    // destructive operation).
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('returns 400 on a SQL-injection-style id', async () => {
    const res = await DELETE(deleteReq("x' OR '1'='1"),
      { params: Promise.resolve({ id: "x' OR '1'='1" }) });
    expect(res.status).toBe(400);
    expect(mocks.pin.findUnique).not.toHaveBeenCalled();
    expect(mocks.pin.delete).not.toHaveBeenCalled();
  });
});
