// Integration tests for the subscriber POST (add) route at
// /api/projects/[id]/subscribers.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { liveSessionRow } from '../helpers/dashboard-auth';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
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
    subscriber: { create: mocks.create },
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

import { POST } from '../../src/app/api/projects/[id]/subscribers/route';
import { NextRequest } from 'next/server';

const CSRF_TOKEN = '***';

function req(body: unknown, origin = 'https://markup.ashbi.ca'): NextRequest {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/subscribers`, {
    method: 'POST',
    headers: {
      'Origin': origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.data.value = 'test-dashboard-session';
  mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  mocks.project.findUnique.mockResolvedValue({ id: PROJECT_ID, teamId: null });
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }: any) => ({
    id: 'sub-1',
    projectId: data.projectId,
    email: data.email,
    createdAt: new Date(),
  }));
});

describe('POST /api/projects/[id]/subscribers', () => {
  it('returns 400 when email is missing', async () => {
    const res = await POST(req({}), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is not a string', async () => {
    const res = await POST(req({ email: 42 }), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(400);
  });

  it('rejects emails > 320 chars (audit log poison guard)', async () => {
    const res = await POST(req({ email: 'a'.repeat(321) + '@example.com' }), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects emails containing CR/LF (header injection guard)', async () => {
    const res = await POST(req({ email: 'alice\n@example.com' }), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns 201 and creates the subscriber on a normal email', async () => {
    const res = await POST(req({ email: 'alice@example.com' }), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, email: 'alice@example.com' },
    });
  });

  it('emits a subscriber.add audit entry with the email', async () => {
    mocks.audit.mockClear();
    await POST(req({ email: 'alice@example.com' }), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: PROJECT_ID,
      action: 'subscriber.add',
      target: PROJECT_ID,
      metadata: { email: 'alice@example.com' },
    });
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await POST(req({ email: 'a@b.com' }, 'https://evil.com'), { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(401);
  });
});
