// Integration tests for the GET /api/audit route.
// Verifies auth, limit clamping, and ordering.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { liveSessionRow } from '../helpers/dashboard-auth';

const mocks = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn() },
  session: { findUnique: vi.fn() },
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
  prisma: mocks,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { GET } from '../../src/app/api/audit/route';
import { NextRequest } from 'next/server';

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('GET /api/audit', () => {
  beforeEach(() => {
    mocks.auditLog.findMany.mockReset();
    cookieStore.data.value = 'test-dashboard-session';
    mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await GET(req('https://markup.ashbi.ca/api/audit'));
    expect(res.status).toBe(401);
  });

  it('returns audit entries in desc order by createdAt', async () => {
    const now = new Date();
    const entries = [
      { id: '1', actor: 'a', action: 'project.create', target: 't', createdAt: now },
      { id: '2', actor: 'b', action: 'project.delete', target: 't', createdAt: new Date(now.getTime() - 1000) },
    ];
    mocks.auditLog.findMany.mockResolvedValue(entries);

    const res = await GET(req('https://markup.ashbi.ca/api/audit', { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(200);
    expect(mocks.auditLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('clamps limit to 500', async () => {
    mocks.auditLog.findMany.mockResolvedValue([]);

    const res = await GET(req('https://markup.ashbi.ca/api/audit?limit=9999', { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(200);
    expect(mocks.auditLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  });
});
