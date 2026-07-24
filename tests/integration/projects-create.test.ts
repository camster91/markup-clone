// Integration tests for POST /api/projects (project creation).
//
// Regression coverage for the SSRF domain-validation wiring. Before the
// fix, this route created a Project with the supplied domain without
// validating it, so an attacker (any dashboard-origin caller) could
// register a project with domain `localhost:5432` or `127.0.0.1` or
// `user@evil.com`. The recapture flow then builds a URL of
// `https://<domain><path>` and shells out to Chromium, turning the
// recapture button into an SSRF vector.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { liveSessionRow } from '../helpers/dashboard-auth';

const mocks = vi.hoisted(() => ({
  project: { create: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }) },
  session: { findUnique: vi.fn() },
  teamMember: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
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

import { POST } from '../../src/app/api/projects/route';
import { NextRequest } from 'next/server';

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://markup.ashbi.ca/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.data.value = 'test-dashboard-session';
  mocks.session.findUnique.mockResolvedValue(liveSessionRow());
  mocks.teamMember.findFirst.mockResolvedValue(null);
  mocks.teamMember.findMany.mockResolvedValue([]);
  mocks.project.create.mockImplementation(async ({ data }: any) => ({
    id: 'proj-1',
    name: data.name,
    domain: data.domain,
    apiKey: data.apiKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    pages: [],
    subscribers: [],
  }));
  mocks.auditLog.create.mockResolvedValue({ id: 'audit-log-1' });
});

describe('POST /api/projects — domain SSRF protection', () => {
  it('accepts a normal public domain', async () => {
    const res = await POST(req({ name: 'Test', domain: 'example.com' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(201);
  });

  it('rejects the literal hostname "localhost"', async () => {
    const res = await POST(req({ name: 'X', domain: 'localhost' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/local|loopback/i);
  });

  it('rejects a .localhost subdomain', async () => {
    const res = await POST(req({ name: 'X', domain: 'admin.localhost' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects a literal IPv4 address', async () => {
    const res = await POST(req({ name: 'X', domain: '127.0.0.1' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects a hostname with a port (SSRF to internal services)', async () => {
    // validateProjectDomain does not allow colons in the hostname; this
    // blocks attempts to point the recapture flow at `localhost:5432` etc.
    const res = await POST(req({ name: 'X', domain: 'localhost:5432' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects a domain with userinfo (Chromium-rendered `https://user@host`)', async () => {
    // The recapture script builds `https://${DOMAIN}${PATH_}`. If the domain
    // is `evil.com#x=markup.ashbi.ca` Chromium would normally reject it, but
    // the more interesting attack is the userinfo form: `user@host` makes
    // Chromium send the request to `host`. The validator catches this by
    // requiring a strict DNS shape.
    const res = await POST(req({ name: 'X', domain: 'user@evil.com' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty name', async () => {
    const res = await POST(req({ name: '', domain: 'example.com' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects a name over 200 chars', async () => {
    const res = await POST(req({ name: 'A'.repeat(201), domain: 'example.com' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('rejects when missing name or domain entirely', async () => {
    const res = await POST(req({ domain: 'example.com' }, { origin: 'https://markup.ashbi.ca' }));
    expect(res.status).toBe(400);
  });

  it('returns 401 when called from a non-dashboard origin', async () => {
    const res = await POST(req({ name: 'X', domain: 'example.com' }));
    expect(res.status).toBe(401);
  });
});
