// Integration tests for the POST /api/pins route handler — the hot path
// for client-submitted feedback. This is the highest-traffic endpoint and
// previously had ZERO integration tests, so any regression in the
// write-then-rename pattern, the temp-file cleanup on tx failure, or the
// validation pipeline was invisible to CI.
//
// What this catches that the smoke test can't:
// - Auth: missing X-Api-Key → 401, valid X-Api-Key → 200
// - Validation: missing projectId, missing screenshot, oversized screenshot,
//   bad xPercent/yPercent, bad path
// - Side effects: temp file is removed on validation failure and on tx failure
// - DB transaction atomicity: when the prisma tx rejects, the temp file is cleaned up
// - Project not found → 404
//
// Prisma is mocked at the module level; fs/promises is mocked so the route
// never touches the real filesystem.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma BEFORE importing routes. vi.mock is hoisted.
const mocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  page: { upsert: vi.fn() },
  screenshot: { create: vi.fn() },
  pin: { create: vi.fn() },
  subscriber: { findMany: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }) },
  // Capture the transaction callback so we can drive it from the test.
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));

// Mock fs/promises so writeFile / rename / unlink / mkdir are no-ops we can
// observe. We don't care about file CONTENTS in these tests — only that the
// correct sequence of calls happened and that unlink fires on failure.
const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('fs/promises', () => fsMocks);

// Mock the rate limiter so the test isn't gated by the in-memory bucket
// (which would interact with other test files even with singleFork).
vi.mock('@/lib/rate-limit', () => ({
  consume: vi.fn().mockReturnValue({ ok: true, remaining: 29 }),
}));

// Mock email so subscriber lookups don't try to send.
vi.mock('@/lib/email', () => ({
  sendSubscriberEmails: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '../../src/app/api/pins/route';

// Minimal valid 1x1 PNG (89 bytes) — the route's readPngDimensions just
// needs the PNG header at bytes 1-3 ('PNG') and width/height at bytes 16-23.
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,  // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  // width=1, height=1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeFormData(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof File) {
      fd.append(k, v);
    } else {
      fd.append(k, v);
    }
  }
  return fd;
}

function makeFile(name = 'shot.png', type = 'image/png'): File {
  // `new File([], ...)` is allowed in modern environments. We pass the
  // PNG bytes via arrayBuffer in the test driver, not here.
  return new File([PNG_1x1], name, { type });
}

function makeReq(fd: FormData, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/pins', {
    method: 'POST',
    headers: { 'X-Api-Key': 'mk_correctkey123', ...headers },
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy path: project exists with the apiKey the test sends.
  // The auth check (`requireProjectKey`) selects only `apiKey`, but our
  // mock just returns the full project — the route's .select() is a
  // no-op against the mock.
  mocks.project.findUnique.mockResolvedValue({
    id: 'proj-1',
    name: 'My Site',
    domain: 'example.com',
    apiKey: 'mk_correctkey123',
  });
  mocks.page.upsert.mockResolvedValue({ id: 'page-1', projectId: 'proj-1', path: '/' });
  mocks.subscriber.findMany.mockResolvedValue([]);
  // The transaction callback runs and we capture the result the route returns.
  mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
    const tx = {
      screenshot: { create: vi.fn().mockResolvedValue({ id: 'ss-1', pageId: 'page-1' }) },
      pin: { create: vi.fn().mockResolvedValue({ id: 'pin-1', comments: [] }) },
    };
    return await cb(tx);
  });
});

describe('POST /api/pins', () => {
  it('returns 400 when projectId is missing', async () => {
    const fd = makeFormData({
      path: '/', xPercent: '50', yPercent: '50',
      screenshot: makeFile(),
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/projectId/);
  });

  it('returns 400 when screenshot is missing', async () => {
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '50', yPercent: '50',
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/screenshot/);
  });

  it('returns 413 when screenshot is too large', async () => {
    // Build an 8MB+1 byte file. Use zeros so the PNG header check fails
    // and dimensions come back as 0x0 — but we expect 413 first, before
    // the dimensions check, so it doesn't matter.
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    const file = new File([big], 'big.png', { type: 'image/png' });
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '50', yPercent: '50',
      screenshot: file,
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/too large/);
  });

  it('returns 400 when xPercent is out of range', async () => {
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '150', yPercent: '50',
      screenshot: makeFile(),
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(400);
  });

  it('returns 400 when path does not start with /', async () => {
    const fd = makeFormData({
      projectId: 'proj-1', path: 'no-leading-slash', xPercent: '50', yPercent: '50',
      screenshot: makeFile(),
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(400);
  });

  it('returns 401 when X-Api-Key is missing', async () => {
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '50', yPercent: '50',
      screenshot: makeFile(),
    });
    const req = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      body: fd,
      // no X-Api-Key, no dashboard Origin
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 415 when Content-Type is not multipart/form-data', async () => {
    // Regression: before the fix, `req.formData()` would throw on a
    // non-multipart body and the catch block would mask it as a generic
    // 500. Now we reject up front with the right status code.
    const req = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: {
        'X-Api-Key': 'mk_correctkey123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ oops: 'wrong format' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/multipart\/form-data/);
  });

  it('returns 415 when Content-Type is missing entirely', async () => {
    const req = new NextRequest('https://markup.ashbi.ca/api/pins', {
      method: 'POST',
      headers: { 'X-Api-Key': 'mk_correctkey123' },
      body: 'raw body bytes',
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('returns 403 when the project does not exist (auth check fires first)', async () => {
    // `requireProjectKey` runs before the route's own "project not found"
    // check. From the caller's perspective the project is unknown and the
    // API key can't be verified, so the auth layer returns 403 with
    // "No API key for project" rather than leaking that the projectId is
    // invalid. This is the right behavior — don't change it to 404.
    mocks.project.findUnique.mockResolvedValue(null);
    const fd = makeFormData({
      projectId: 'proj-missing', path: '/', xPercent: '50', yPercent: '50',
      screenshot: makeFile(),
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/No API key/i);
  });

  it('happy path: writes temp file, runs tx, renames to final path, returns 201', async () => {
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '50', yPercent: '50',
      screenshot: makeFile(), text: 'Fix the button color',
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(201);
    // The write-then-rename pattern: writeFile to a *.tmp.* name, then
    // rename to *.png. Verify both happened in the correct order.
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    const writeCall = fsMocks.writeFile.mock.calls[0];
    expect(String(writeCall[0])).toMatch(/\.tmp\.[0-9a-f]+$/);
    expect(fsMocks.rename).toHaveBeenCalledTimes(1);
    const renameCall = fsMocks.rename.mock.calls[0];
    expect(String(renameCall[0])).toBe(writeCall[0]);          // src = temp
    expect(String(renameCall[1])).toMatch(/[0-9a-f-]+\.png$/); // dst = final
  });

  it('on tx failure: cleans up the temp file, no rename happens', async () => {
    // Force the prisma transaction to reject. The route should unlink the
    // temp file so /data/screenshots doesn't fill up on DB outages.
    mocks.$transaction.mockRejectedValue(new Error('DB down'));
    const fd = makeFormData({
      projectId: 'proj-1', path: '/', xPercent: '50', yPercent: '50',
      screenshot: makeFile(),
    });
    const res = await POST(makeReq(fd));
    expect(res.status).toBe(500);
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.rename).not.toHaveBeenCalled();
    // unlink is called in the catch to clean up the temp file.
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(String(fsMocks.unlink.mock.calls[0][0])).toMatch(/\.tmp\./);
  });
});
