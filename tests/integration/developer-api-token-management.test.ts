import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const TOKEN_ID = '50000000-0000-4000-8000-000000000001';
const CSRF = 'developer-token-csrf';

const mocks = vi.hoisted(() => ({
  projectApiToken: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => ({
  assertProjectAdmin: vi.fn(async () => ({
    ok: true, projectId: PROJECT_ID, teamId: 'client-1',
    caller: { id: 'owner-1', email: 'owner@example.test', role: 'reviewer' }, membershipRole: 'owner',
  })),
}));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireDashboardAuth: vi.fn(async () => null) };
});

import { GET, POST } from '@/app/api/projects/[id]/api-tokens/route';
import { DELETE } from '@/app/api/projects/[id]/api-tokens/[tokenId]/route';

function request(method: string, body?: unknown) {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/api-tokens`, {
    method,
    headers: {
      origin: 'https://markup.ashbi.ca', 'Content-Type': 'application/json',
      cookie: `markup.csrf=${CSRF}`, 'X-CSRF-Token': CSRF,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectApiToken.findMany.mockResolvedValue([]);
});

describe('developer token dashboard management', () => {
  it('lists safe metadata without token hashes or plaintext secrets', async () => {
    mocks.projectApiToken.findMany.mockResolvedValue([{
      id: TOKEN_ID, name: 'CI', tokenPrefix: 'mkv1_', tokenLastFour: 'Ab_9',
      scope: 'issues:read', expiresAt: null, revokedAt: null, lastUsedAt: null,
      createdAt: new Date('2026-08-08T00:00:00.000Z'), tokenHash: 'must-not-render',
    }]);
    const response = await GET(request('GET'), { params: Promise.resolve({ id: PROJECT_ID }) });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('Ab_9');
    expect(text).not.toContain('must-not-render');
    expect(mocks.projectApiToken.findMany.mock.calls[0][0].select).not.toHaveProperty('tokenHash');
  });

  it('returns a valid secret exactly once while persisting only its hash', async () => {
    mocks.projectApiToken.create.mockImplementation(async ({ data }) => ({
      id: TOKEN_ID, name: data.name, tokenPrefix: data.tokenPrefix, tokenLastFour: data.tokenLastFour,
      scope: data.scope, expiresAt: data.expiresAt, revokedAt: null, lastUsedAt: null,
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
    }));
    const response = await POST(request('POST', { name: 'CI integration', expiresAt: null }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.secret).toMatch(/^mkv1_[A-Za-z0-9_-]{43}$/);
    const stored = mocks.projectApiToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(body.secret);
    expect(body.token).not.toHaveProperty('tokenHash');
  });

  it('rejects unsupported scopes and invalid expiry before persistence', async () => {
    const scope = await POST(request('POST', { name: 'CI', scope: 'issues:write' }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    expect(scope.status).toBe(400);
    const expiry = await POST(request('POST', { name: 'CI', expiresAt: '2020-01-01T00:00:00.000Z' }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    expect(expiry.status).toBe(400);
    expect(mocks.projectApiToken.create).not.toHaveBeenCalled();
  });

  it('revokes a token only inside the authorized project', async () => {
    mocks.projectApiToken.findFirst.mockResolvedValue({ id: TOKEN_ID, revokedAt: null });
    mocks.projectApiToken.update.mockResolvedValue({ id: TOKEN_ID, revokedAt: new Date() });
    const response = await DELETE(request('DELETE'), {
      params: Promise.resolve({ id: PROJECT_ID, tokenId: TOKEN_ID }),
    });
    expect(response.status).toBe(200);
    expect(mocks.projectApiToken.findFirst).toHaveBeenCalledWith({
      where: { id: TOKEN_ID, projectId: PROJECT_ID }, select: { id: true, revokedAt: true },
    });
    expect(mocks.projectApiToken.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
  });
});
