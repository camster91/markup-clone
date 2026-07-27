// Integration tests for the subscriber DELETE-by-email route at
// /api/projects/[id]/subscribers/[email]. This route is idempotent
// (deleteMany doesn't throw on zero matches) but the response now
// includes the count and an audit log entry.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  audit: vi.fn(),
  projectFindUnique: vi.fn().mockResolvedValue({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    teamId: null,
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscriber: { deleteMany: mocks.deleteMany },
    project: { findUnique: mocks.projectFindUnique },
  },
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

import { DELETE } from '../../src/app/api/projects/[id]/subscribers/[email]/route';
import { NextRequest } from 'next/server';

// Test CSRF token used by the request builders. The route's
// `requireCsrfToken` check (see `src/lib/csrf.ts`) requires the
// X-CSRF-Token header to match the `markup.csrf` cookie.
const CSRF_TOKEN='***';

function req(origin = 'https://markup.ashbi.ca'): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/subscribers/alice%40example.com', {
    method: 'DELETE',
    headers: {
      'Origin': origin,
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: delete 0 (idempotent — the email wasn't a subscriber).
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

describe('DELETE /api/projects/[id]/subscribers/[email]', () => {
  it('returns { deleted: true, count: 0 } when the email is not a subscriber', async () => {
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'nobody@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 0 });
  });

  it('returns { deleted: true, count: 1 } when the email was a subscriber', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
  });

  it('URL-decodes + signs in the email (alice+test@example.com)', async () => {
    // The client encodes + as %2B; the route must see the literal +.
    const r = new NextRequest(
      'https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/subscribers/alice%2Btest%40example.com',
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca', 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` } }
    );
    await DELETE(r, { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice+test@example.com' }) });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice+test@example.com' },
    });
  });

  it('rejects emails containing CR/LF (header injection guard)', async () => {
    // Next decodes the path segment, so a CR/LF could otherwise be a
    // header-injection vector if the email is later rendered in an
    // email/Slack context (the audit log is the obvious place).
    // The validator's shape regex rejects CR/LF as part of the
    // generic "not a valid address" check, so the response uses that
    // error message — but the underlying intent is the same: don't
    // let a path-segment CR/LF reach the DB / audit log.
    const r = new NextRequest(
      'https://markup.ashbi.ca/api/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/subscribers/alice%0ACc%3Aattacker%40example.com',
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca', 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` } }
    );
    const res = await DELETE(r, { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice\nCc:attacker@example.com' }) });
    expect(res.status).toBe(400);
    // And we did NOT call deleteMany (so no DB write).
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await DELETE(req('https://evil.com'), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice@example.com' }) });
    expect(res.status).toBe(401);
  });

  it('emits a subscriber.remove audit entry with the count', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.audit.mockClear();
    await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice@example.com' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      action: 'subscriber.remove',
      target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      metadata: { email: 'alice@example.com', requested: 'alice@example.com', count: 1 },
    });
  });

  // R0.3 closeout (A4): the DELETE route used to pass `email` straight
  // into the prisma where-clause. The POST route lowercases on the way
  // in, so the row in the DB is `alice@example.com` but the operator's
  // dashboard might request `Alice@Example.com` and silently match 0
  // rows. The fix: validateSubscriberEmail (which lowercases) at the
  // route boundary, so the WHERE clause uses the same form as POST.
  it('lowercases a MixedCase email so the WHERE clause matches the stored row', async () => {
    // The DB row was stored as `alice@example.com` (POST lowercased on
    // the way in). The dashboard DELETE requests `Alice@Example.com`.
    // After the fix, the route normalizes BEFORE the deleteMany call,
    // so the mock should see the lowercased form.
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'Alice@Example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
    // The key assertion: deleteMany was called with the lowercased form
    // that matches what POST stored.
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'alice@example.com' },
    });
  });

  it('audit log records both the normalized email and the original request', async () => {
    // The audit log gets the lowercased form (what was actually used
    // in the WHERE clause) AND the original input (so the operator can
    // trace what the dashboard sent). The split is minor but it means
    // the log is unambiguous if there's a case-mismatch investigation
    // later.
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.audit.mockClear();
    await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'Alice@Example.com' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      action: 'subscriber.remove',
      target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      metadata: {
        email: 'alice@example.com',
        requested: 'Alice@Example.com',
        count: 1,
      },
    });
  });

  it('rejects a clearly-malformed email with 400 (defense in depth)', async () => {
    // The validator's email-shape regex rejects obvious garbage
    // (missing @, missing domain, etc.). The DELETE route should now
    // return 400 on these instead of forwarding to the DB.
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'not-an-email' }) });
    expect(res.status).toBe(400);
    // The DB must NOT be hit on bad input.
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
