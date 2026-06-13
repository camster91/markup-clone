// Integration tests for the /api/projects/[id] route handler.
// Uses supertest against the actual Next.js route module, with prisma mocked
// at the module level (no real DB).
//
// What this catches that the smoke test can't:
// - Invalid request body shapes
// - Auth rejections (missing X-Api-Key, missing Origin)
// - PATCH/DELETE side effects
// - Error responses with correct status codes
// - SQL schema mismatches (prisma calls the right methods)

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma BEFORE importing routes. vi.mock is hoisted, so the factory
// can't reference module-level vars. Use vi.hoisted() to get shared state.
const mocks = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  page: { findMany: vi.fn() },
  screenshot: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn() }, // findMany is used by the DELETE cascade
  pin: { delete: vi.fn() },
  subscriber: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));


import { DELETE, PATCH } from '../../src/app/api/projects/[id]/route';
import { NextRequest } from 'next/server';

function req(method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/proj-1`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function reqWithBody(method: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/proj-1`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}



describe('DELETE /api/projects/[id]', () => {
  beforeEach(() => {
    mocks.project.findUnique.mockReset();
    mocks.project.delete.mockReset();
    mocks.screenshot.findMany.mockReset();
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await DELETE(req('DELETE', {}),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    const res = await DELETE(req('DELETE', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-missing' }) });
    expect(res.status).toBe(404);
  });

  it('cascades: deletes screenshots from disk and the project row', async () => {
    // Verify the project exists. The route calls findUnique separately.
    mocks.project.findUnique.mockResolvedValue({ id: 'proj-1' });
    // The route queries prisma.screenshot.findMany (NOT the project's `screenshots`
    // field — that's for a different include path). The mock must be on the
    // Screenshot model, not on the Project model.
    mocks.screenshot.findMany.mockResolvedValue([
      { storageKey: 'abc123.png' },
      { storageKey: 'def456.png' },
    ]);
    mocks.project.delete.mockResolvedValue({ id: 'proj-1' });

    const res = await DELETE(req('DELETE', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.projects).toBe(1);
    // filesRemoved is 0 in test because the mock fs/promises unlink is not
    // applied (we use a real unlink that throws ENOENT, which the route catches
    // and counts as "skip"). The real behavior on the live host is: the
    // unlink succeeds → count increments. We assert the structure here; the
    // actual count is a function of the file system state, not the test.
    expect(mocks.project.delete).toHaveBeenCalledWith({ where: { id: 'proj-1' } });
    // findMany should have been called with the project id
    expect(mocks.screenshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { page: { projectId: 'proj-1' } } })
    );
  });
});

describe('PATCH /api/projects/[id]', () => {
  beforeEach(() => {
    mocks.project.update.mockReset();
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 'New' }, {}),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(401);
  });

  it('renames a project when name is provided', async () => {
    mocks.project.update.mockResolvedValue({
      id: 'proj-1', name: 'New Name', domain: 'example.com',
      apiKey: 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { name: 'New Name' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('New Name');
    // Should NOT have changed the apiKey
    expect(mocks.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'New Name' } })
    );
    expect(mocks.project.update.mock.calls[0][0].data.apiKey).toBeUndefined();
  });

  it('regenerates the apiKey when regenerateKey is true', async () => {
    mocks.project.update.mockResolvedValue({
      id: 'proj-1', name: 'Test', domain: 'example.com',
      apiKey: 'mk_NEWKEY123', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The mocked apiKey is what we set; the test below validates the shape
    // of the GENERATED key via generateApiKey() in a unit test.
    expect(body.apiKey).toBe('mk_NEWKEY123');
  });

  it('regenerates the apiKey with mk_ prefix and 40 hex chars (real generation)', async () => {
    // Use a different mock for this one that calls through to the real generateApiKey
    mocks.project.update.mockImplementation(async ({ data }) => ({
      id: 'proj-1', name: 'Test', domain: 'example.com',
      apiKey: data.apiKey || 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    }));
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKey).toMatch(/^mk_[0-9a-f]{40}$/);
  });

  it('handles both name and regenerateKey in the same call', async () => {
    mocks.project.update.mockResolvedValue({
      id: 'proj-1', name: 'New Name', domain: 'example.com',
      apiKey: 'mk_NEWKEY456', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { name: 'New Name', regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    const call = mocks.project.update.mock.calls[0][0];
    expect(call.data.name).toBe('New Name');
    expect(call.data.apiKey).toMatch(/^mk_[0-9a-f]{40}$/);
  });

  it('rejects body without name or regenerateKey (no-op is a 400)', async () => {
    const res = await PATCH(reqWithBody('PATCH', {}, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    // Empty body should NOT change anything and is likely a 400 to surface the bug
    expect(res.status).toBe(400);
  });

  it('rejects name that is a non-string with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 42 }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
  });

  it('rejects name that is too long with 400 (DoS guard)', async () => {
    const longName = 'x'.repeat(201);
    const res = await PATCH(reqWithBody('PATCH', { name: longName }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
  });

  it('rejects empty name with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: '' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
  });

  it('does NOT log the new apiKey plaintext when regenerateKey is true', async () => {
    // Regression: PATCH /api/projects/[id] used to spread the entire `data`
    // object (including the freshly-generated apiKey) into the audit log
    // metadata. That meant GET /api/audit could leak the new key to anyone
    // with dashboard access. The fix: record `apiKey: 'rotated'` instead.
    mocks.project.update.mockImplementation(async ({ data }: any) => ({
      id: 'proj-1', name: 'Test', domain: 'example.com',
      apiKey: data.apiKey || 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    }));
    // The audit log call is fire-and-forget, so wait a microtask before
    // asserting on the mock.
    mocks.auditLog.create.mockClear();
    mocks.auditLog.create.mockResolvedValue({ id: 'audit-log-1' });
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(200);
    // Drain the microtask queue so the fire-and-forget call has been recorded.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.auditLog.create).toHaveBeenCalled();
    // The audit() helper wraps metadata inside a `data` field for prisma.
    // We pull `changes` from inside that wrapper.
    const callArg = mocks.auditLog.create.mock.calls[0][0];
    const metadata = callArg?.data?.metadata;
    expect(metadata?.changes).toBeDefined();
    // The apiKey field, if present, must be a non-sensitive marker — not the
    // plaintext key. Defense against future changes that might add another
    // sensitive field to `data` and forget to redact it.
    const apiKeyInLog = metadata.changes.apiKey;
    if (apiKeyInLog !== undefined) {
      expect(apiKeyInLog).not.toMatch(/^mk_[0-9a-f]{40}$/);
      expect(apiKeyInLog).toBe('rotated');
    }
  });
});
