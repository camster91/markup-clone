// Integration tests for the subscriber DELETE-by-email route at
// /api/projects/[id]/subscribers/[email]. This route is idempotent
// (deleteMany doesn't throw on zero matches) but the response now
// includes the count and an audit log entry.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { liveSessionRow } from '../helpers/dashboard-auth';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  audit: vi.fn(),
  project: { findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
  teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
}));

const cookieStore = vi.hoisted(() => {
  const data: { value?: string } = { value: 'test-dashboard-session' };
  return {
    data,
    get: (name: string) => (data.value !== undefined ? { name, value: data.value } : undefined),
    set: (_n: string, value: string) => { data.value = value === '' ? undefined : value; },
    delete: () => { data.value = undefined; },
    has: () => data.value !== undefined,
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscriber: { deleteMany: mocks.deleteMany },
    project: mocks.project,
    session: mocks.session,
    teamMember: mocks.teamMember,
  },
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { DELETE } from '../../src/app/api/projects/[id]/subscribers/[email]/route';
import { NextRequest } from 'next/server';

const CSRF_TOKEN = '***';

function req(origin = 'https://markup.ashbi.ca'): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/subscribers/alice%40example.com`, {
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
  cookieStore.data.value = 'test-dashboard-session';
  mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  mocks.project.findUnique.mockResolvedValue({ id: PROJECT_ID, teamId: null });
  mocks.teamMember.findFirst.mockResolvedValue(null);
  // Default: delete 0 (idempotent — the email wasn't a subscriber).
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

describe('DELETE /api/projects/[id]/subscribers/[email]', () => {
  it('returns { deleted: true, count: 0 } when the email is not a subscriber', async () => {
    const res = await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'nobody@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 0 });
  });

  it('returns { deleted: true, count: 1 } when the email was a subscriber', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'alice@example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
  });

  it('URL-decodes + signs in the email (alice+test@example.com)', async () => {
    // The client encodes + as %2B; the route must see the literal +.
    const r = new NextRequest(
      `https://markup.ashbi.ca/api/projects/${PROJECT_ID}/subscribers/alice%2Btest%40example.com`,
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca', 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` } }
    );
    await DELETE(r, { params: Promise.resolve({ id: PROJECT_ID, email: 'alice+test@example.com' }) });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, email: 'alice+test@example.com' },
    });
  });

  it('rejects emails containing CR/LF (header injection guard)', async () => {
    const r = new NextRequest(
      `https://markup.ashbi.ca/api/projects/${PROJECT_ID}/subscribers/alice%0ACc%3Aattacker%40example.com`,
      { method: 'DELETE', headers: { 'Origin': 'https://markup.ashbi.ca', 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` } }
    );
    const res = await DELETE(r, { params: Promise.resolve({ id: PROJECT_ID, email: 'alice\nCc:attacker@example.com' }) });
    expect(res.status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await DELETE(req('https://evil.com'), { params: Promise.resolve({ id: PROJECT_ID, email: 'alice@example.com' }) });
    expect(res.status).toBe(401);
  });

  it('emits a subscriber.remove audit entry with the count', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.audit.mockClear();
    await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'alice@example.com' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: PROJECT_ID,
      action: 'subscriber.remove',
      target: PROJECT_ID,
      metadata: { email: 'alice@example.com', requested: 'alice@example.com', count: 1 },
    });
  });

  it('lowercases a MixedCase email so the WHERE clause matches the stored row', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'Alice@Example.com' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, count: 1 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, email: 'alice@example.com' },
    });
  });

  it('audit log records both the normalized email and the original request', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.audit.mockClear();
    await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'Alice@Example.com' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: PROJECT_ID,
      action: 'subscriber.remove',
      target: PROJECT_ID,
      metadata: {
        email: 'alice@example.com',
        requested: 'Alice@Example.com',
        count: 1,
      },
    });
  });

  it('rejects a clearly-malformed email with 400 (defense in depth)', async () => {
    const res = await DELETE(req(), { params: Promise.resolve({ id: PROJECT_ID, email: 'not-an-email' }) });
    expect(res.status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
