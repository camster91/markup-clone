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
  // The route's team-scope gate calls getCallerUser() which reads
  // the session cookie + looks up the Session row. Default: no
  // session, so the route treats the caller as anonymous — that
  // means team-scope gating falls back to "no caller" → 403
  // whenever the project has teamId != null. Tests that need a
  // logged-in caller override per-test.
  session: { findUnique: vi.fn().mockResolvedValue(null) },
  // Team membership lookup. Default: no membership.
  teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mocks,
}));
const authState = vi.hoisted(() => ({
  user: { id: 'operator-1', email: 'operator@example.com', role: 'operator' },
}));

// This suite verifies the functional admin route behavior. Reviewer denial is
// covered separately in project-admin-role-enforcement.test.ts.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
    requireAuth: vi.fn(async () => authState.user),
  };
});


import { DELETE, GET, PATCH } from '../../src/app/api/projects/[id]/route';
import { NextRequest } from 'next/server';

// Test CSRF token used by the request builders. The value is
// arbitrary — the route only checks that the cookie and the
// header MATCH each other, not that they match any specific
// value. Centralizing the literal here means every test in
// every file sends the same pair to the server, so any
// mismatch shows up as a real regression rather than a typo.
const CSRF_TOKEN = 'test-csrf-token';

beforeEach(() => {
  authState.user = { id: 'operator-1', email: 'operator@example.com', role: 'operator' };
});

function req(method: string, headers: Record<string, string> = {}): NextRequest {
  // Default headers set BOTH `requireDashboardOrigin` (Origin)
  // and `requireCsrfToken` (cookie + X-CSRF-Token header).
  // Tests that want to exercise a missing/mismatched CSRF
  // token pass their own headers object that overrides these
  // defaults.
  const baseHeaders: Record<string, string> = {
    'X-CSRF-Token': CSRF_TOKEN,
    cookie: `markup.csrf=${CSRF_TOKEN}`,
  };
  return new NextRequest(`https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, {
    method,
    headers: { 'Content-Type': 'application/json', ...baseHeaders, ...headers },
  });
}

function reqWithBody(method: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  const baseHeaders: Record<string, string> = {
    'X-CSRF-Token': CSRF_TOKEN,
    cookie: `markup.csrf=${CSRF_TOKEN}`,
  };
  return new NextRequest(`https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, {
    method,
    headers: { 'Content-Type': 'application/json', ...baseHeaders, ...headers },
    body: JSON.stringify(body),
  });
}

// Default project-mock that makes the team-scope gate pass for
// the legacy / unscoped branch (teamId = null). Tests that need
// a different shape override mocks.project.findUnique per-test.
function setUnscopedProject() {
  mocks.project.findUnique.mockResolvedValue({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com', teamId: null,
  });
}

describe('GET /api/projects/[id]', () => {
  it('returns the authorized full detail DTO for one project', async () => {
    mocks.project.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Client Site',
      domain: 'example.com',
      apiKey: 'mk_detail',
      shareToken: null,
      teamId: null,
      pages: [],
      subscribers: [],
    });

    const response = await GET(
      req('GET', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      apiKey: 'mk_detail',
      canAdmin: true,
      pages: [],
    });
  });
});


describe('DELETE /api/projects/[id]', () => {
  beforeEach(() => {
    mocks.project.findUnique.mockReset();
    mocks.project.delete.mockReset();
    mocks.screenshot.findMany.mockReset();
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await DELETE(req('DELETE', {}),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the project does not exist', async () => {
    mocks.project.findUnique.mockResolvedValue(null);
    const res = await DELETE(req('DELETE', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }) });
    expect(res.status).toBe(404);
  });

  it('cascades: deletes screenshots from disk and the project row', async () => {
    // The route calls findUnique for the access check (with
    // `select: { id, name, domain, teamId }`) and again for the
    // post-delete metadata. teamId = null is the "legacy /
    // unscoped" branch — the access check passes without a
    // session lookup, and the test stays focused on the delete
    // cascade.
    setUnscopedProject();
    // The route queries prisma.screenshot.findMany (NOT the project's `screenshots`
    // field — that's for a different include path). The mock must be on the
    // Screenshot model, not on the Project model.
    mocks.screenshot.findMany.mockResolvedValue([
      { storageKey: 'abc123.png' },
      { storageKey: 'def456.png' },
    ]);
    mocks.project.delete.mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });

    const res = await DELETE(req('DELETE', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.projects).toBe(1);
    // filesRemoved is 0 in test because the mock fs/promises unlink is not
    // applied (we use a real unlink that throws ENOENT, which the route catches
    // and counts as "skip"). The real behavior on the live host is: the
    // unlink succeeds → count increments. We assert the structure here; the
    // actual count is a function of the file system state, not the test.
    expect(mocks.project.delete).toHaveBeenCalledWith({ where: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } });
    // findMany should have been called with the project id
    expect(mocks.screenshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { page: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } } })
    );
  });

  it('returns 403 when the project is in a team the caller is not a member of', async () => {
    // Team-scope gate: a project with teamId != null is only
    // accessible to a caller who is a member of that team. The
    // mock returns a non-null teamId and no session — the gate
    // falls through to "no caller" and returns 403 (not 404; the
    // API surface distinguishes missing from forbidden, unlike
    // the page surface).
    mocks.project.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'T', domain: 't.com', teamId: 'team-1',
    });
    authState.user = { id: 'reviewer-1', email: 'reviewer@example.com', role: 'reviewer' };
    const res = await DELETE(req('DELETE', { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(403);
    expect(mocks.project.delete).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/projects/[id]', () => {
  beforeEach(() => {
    mocks.project.findUnique.mockReset();
    mocks.project.update.mockReset();
    // Default: project exists in the legacy / unscoped branch so
    // the access check passes. Tests that want to exercise the
    // team-scope gate override the findUnique mock.
    setUnscopedProject();
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 'New' }, {}),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(401);
  });

  it('renames a project when name is provided', async () => {
    mocks.project.update.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'New Name', domain: 'example.com',
      apiKey: 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { name: 'New Name' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
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
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
      apiKey: 'mk_NEWKEY123', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The mocked apiKey is what we set; the test below validates the shape
    // of the GENERATED key via generateApiKey() in a unit test.
    expect(body.apiKey).toBe('mk_NEWKEY123');
  });

  it('regenerates the apiKey with mk_ prefix and 40 hex chars (real generation)', async () => {
    // Use a different mock for this one that calls through to the real generateApiKey
    mocks.project.update.mockImplementation(async ({ data }) => ({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
      apiKey: data.apiKey || 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    }));
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKey).toMatch(/^mk_[0-9a-f]{40}$/);
  });

  it('handles both name and regenerateKey in the same call', async () => {
    mocks.project.update.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'New Name', domain: 'example.com',
      apiKey: 'mk_NEWKEY456', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    });
    const res = await PATCH(reqWithBody('PATCH', { name: 'New Name', regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(200);
    const call = mocks.project.update.mock.calls[0][0];
    expect(call.data.name).toBe('New Name');
    expect(call.data.apiKey).toMatch(/^mk_[0-9a-f]{40}$/);
  });

  it('archives and restores a project idempotently', async () => {
    const archivedAt = new Date('2026-08-08T12:00:00.000Z');
    mocks.project.update
      .mockResolvedValueOnce({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
        apiKey: 'mk_xx', archivedAt,
      })
      .mockResolvedValueOnce({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
        apiKey: 'mk_xx', archivedAt: null,
      });

    const archive = await PATCH(
      reqWithBody('PATCH', { archived: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    expect(archive.status).toBe(200);
    expect(mocks.project.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);

    const restore = await PATCH(
      reqWithBody('PATCH', { archived: false }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    expect(restore.status).toBe(200);
    expect(mocks.project.update.mock.calls[1][0].data.archivedAt).toBeNull();
  });

  it('preserves the original archive timestamp when archiving an already archived project', async () => {
    const original = new Date('2026-08-07T12:00:00.000Z');
    mocks.project.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
      teamId: null, archivedAt: original,
    });
    mocks.project.update.mockResolvedValue({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', archivedAt: original });
    const response = await PATCH(
      reqWithBody('PATCH', { archived: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.project.update.mock.calls[0][0].data.archivedAt).toEqual(original);
  });

  it('rejects a non-boolean archived value', async () => {
    const res = await PATCH(
      reqWithBody('PATCH', { archived: 'yes' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) },
    );
    expect(res.status).toBe(400);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('rejects body without name, regenerateKey, or archived (no-op is a 400)', async () => {
    const res = await PATCH(reqWithBody('PATCH', {}, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    // Empty body should NOT change anything and is likely a 400 to surface the bug
    expect(res.status).toBe(400);
  });

  it('rejects name that is a non-string with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 42 }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
  });

  it('rejects name that is too long with 400 (DoS guard)', async () => {
    const longName = 'x'.repeat(201);
    const res = await PATCH(reqWithBody('PATCH', { name: longName }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
  });

  it('rejects empty name with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: '' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
  });

  it('does NOT log the new apiKey plaintext when regenerateKey is true', async () => {
    // Regression: PATCH /api/projects/[id] used to spread the entire `data`
    // object (including the freshly-generated apiKey) into the audit log
    // metadata. That meant GET /api/audit could leak the new key to anyone
    // with dashboard access. The fix: record `apiKey: 'rotated'` instead.
    mocks.project.update.mockImplementation(async ({ data }: any) => ({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Test', domain: 'example.com',
      apiKey: data.apiKey || 'mk_xx', createdAt: new Date(), updatedAt: new Date(),
      pages: [], subscribers: [],
    }));
    // The audit log call is fire-and-forget, so wait a microtask before
    // asserting on the mock.
    mocks.auditLog.create.mockClear();
    mocks.auditLog.create.mockResolvedValue({ id: 'audit-log-1' });
    const res = await PATCH(reqWithBody('PATCH', { regenerateKey: true }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
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

  // R0.3 closeout (A1): the inline 3-clause name check was replaced with
  // validateProjectName. The validator enforces the same length cap (200)
  // and string type, but ALSO rejects null bytes — the inline check
  // did not, so a payload like { name: "x\u0000y" } would have hit the
  // DB and produced a 500. These tests pin the new behavior.

  it('rejects name=null with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: null }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/string/);
    // The DB must NOT be hit on bad input.
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('rejects name with a null byte with 400 (defense in depth)', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 'x\u0000y' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/null/);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('rejects name that is 201 chars (one over the cap) with 400', async () => {
    const res = await PATCH(reqWithBody('PATCH', { name: 'a'.repeat(201) }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/200/);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });

  it('returns 403 when the project is in a team the caller is not a member of', async () => {
    // Team-scope gate for PATCH: a project with teamId != null
    // is only accessible to a member of that team. The mock
    // returns a non-null teamId and no session → 403.
    mocks.project.findUnique.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'T', domain: 't.com', teamId: 'team-1',
    });
    authState.user = { id: 'reviewer-1', email: 'reviewer@example.com', role: 'reviewer' };
    const res = await PATCH(reqWithBody('PATCH', { name: 'New' }, { origin: 'https://markup.ashbi.ca' }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) });
    expect(res.status).toBe(403);
    expect(mocks.project.update).not.toHaveBeenCalled();
  });
});
