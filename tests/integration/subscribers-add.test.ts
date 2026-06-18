// Integration tests for the subscriber POST (add) route at
// /api/projects/[id]/subscribers.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscriber: { create: mocks.create },
  },
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

import { POST } from '../../src/app/api/projects/[id]/subscribers/route';
import { NextRequest } from 'next/server';

// Test CSRF token used by the request builders. The route's
// `requireCsrfToken` check (see `src/lib/csrf.ts`) requires the
// X-CSRF-Token header to match the `markup.csrf` cookie, so the
// request builders below inject both. Centralizing the literal
// means a typo in the test code can't accidentally pair a
// mismatched cookie and header.
const CSRF_TOKEN='***';

function req(body: unknown, origin = 'https://markup.ashbi.ca'): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/projects/proj-1/subscribers', {
    method: 'POST',
    // CSRF: cookie + X-CSRF-Token header must match. Tests
    // that want to exercise a missing/mismatched CSRF token
    // build their own request without these headers.
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
  mocks.create.mockImplementation(async ({ data }: any) => ({
    id: 'sub-1',
    projectId: data.projectId,
    email: data.email,
    createdAt: new Date(),
  }));
});

describe('POST /api/projects/[id]/subscribers', () => {
  it('returns 400 when email is missing', async () => {
    const res = await POST(req({}), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is not a string', async () => {
    const res = await POST(req({ email: 42 }), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
  });

  it('rejects emails > 320 chars (audit log poison guard)', async () => {
    const res = await POST(req({ email: 'a'.repeat(321) + '@example.com' }), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects emails containing CR/LF (header injection guard)', async () => {
    const res = await POST(req({ email: 'alice\n@example.com' }), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns 201 and creates the subscriber on a normal email', async () => {
    const res = await POST(req({ email: 'alice@example.com' }), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { projectId: 'proj-1', email: 'alice@example.com' },
    });
  });

  it('emits a subscriber.add audit entry with the email', async () => {
    mocks.audit.mockClear();
    await POST(req({ email: 'alice@example.com' }), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'proj-1',
      action: 'subscriber.add',
      target: 'proj-1',
      metadata: { email: 'alice@example.com' },
    });
  });

  it('returns 401 from a non-dashboard origin', async () => {
    const res = await POST(req({ email: 'a@b.com' }, 'https://evil.com'), { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(401);
  });
});
