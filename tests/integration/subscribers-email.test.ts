// Integration tests for the subscriber DELETE-by-email route at
// /api/projects/[id]/subscribers/[email]. This route is idempotent
// (deleteMany doesn't throw on zero matches) but the response now
// includes the count and an audit log entry.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscriber: { deleteMany: mocks.deleteMany },
  },
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

import { DELETE } from '../../src/app/api/projects/[id]/subscribers/[email]/route';
import { NextRequest } from 'next/server';

function req(origin = 'https://markup.ashbi.ca'): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/projects/proj-1/subscribers/alice%40example.com', {
    method: 'DELETE',
    headers: { 'Origin': origin },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: delete 0 (idempotent — the email wasn't a subscriber).
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

describe('DELETE /api/projects/[id]/subscribers/[email]', () => {
  it('returns { deleted: true, count: 0 } when the email is not a subscriber', async () => {
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'proj-1', email: 'nobody@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 0 });
  });

  it('returns { deleted: true, count: 1 } when the email was a subscriber', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'proj-1', email: 'alice@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
  });

  it('URL-decodes + signs in the email (alice+test@example.com)', async () => {
    // The client encodes + as %2B; the route must see the literal +.
    const r = new NextRequest(
      'https://markup.ashbi.ca/api/projects/proj-1/subscribers/alice%2Btest%40example.com',
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca' } }
    );
    await DELETE(r, { params: Promise.resolve({ id: 'proj-1', email: 'alice+test@example.com' }) });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', email: 'alice+test@example.com' },
    });
  });

  it('rejects emails containing CR/LF (header injection guard)', async () => {
    // Next decodes the path segment, so a CR/LF could otherwise be a
    // header-injection vector if the email is later rendered in an
    // email/Slack context (the audit log is the obvious place).
    const r = new NextRequest(
      'https://markup.ashbi.ca/api/projects/proj-1/subscribers/alice%0ACc%3Aattacker%40example.com',
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca' } }
    );
    const res = await DELETE(r, { params: Promise.resolve({ id: 'proj-1', email: 'alice\nCc:attacker@example.com' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/control characters/);
    // And we did NOT call deleteMany (so no DB write).
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await DELETE(req('https://evil.com'), { params: Promise.resolve({ id: 'proj-1', email: 'alice@example.com' }) });
    expect(res.status).toBe(401);
  });

  it('emits a subscriber.remove audit entry with the count', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.audit.mockClear();
    await DELETE(req(), { params: Promise.resolve({ id: 'proj-1', email: 'alice@example.com' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'proj-1',
      action: 'subscriber.remove',
      target: 'proj-1',
      metadata: { email: 'alice@example.com', count: 1 },
    });
  });
});
