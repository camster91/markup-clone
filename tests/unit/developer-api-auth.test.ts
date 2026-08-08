import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectApiToken: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  consume: vi.fn(() => ({ ok: true, remaining: 119 })),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { projectApiToken: mocks.projectApiToken } }));
vi.mock('@/lib/rate-limit', () => ({ consume: mocks.consume }));

import { authenticateDeveloperApi } from '@/lib/developer-api-auth';
import { hashDeveloperToken } from '@/lib/developer-api-tokens';

const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const SECRET = `mkv1_${'A'.repeat(43)}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockReturnValue({ ok: true, remaining: 119 });
});

function request(value: string | null = `Bearer ${SECRET}`) {
  return new Request('https://markup.example/api/v1/projects/x/issues', {
    headers: value ? { Authorization: value } : {},
  });
}

describe('developer API bearer authentication', () => {
  it('authenticates an active scoped project token and never looks up plaintext', async () => {
    mocks.projectApiToken.findUnique.mockResolvedValue({
      id: 'token-1', projectId: PROJECT_ID, scope: 'issues:read',
      expiresAt: null, revokedAt: null, project: { archivedAt: null },
    });
    const result = await authenticateDeveloperApi(request(), PROJECT_ID, 'issues:read');
    expect(result).toMatchObject({ ok: true, tokenId: 'token-1', projectId: PROJECT_ID });
    expect(mocks.projectApiToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: hashDeveloperToken(SECRET) },
    }));
    expect(JSON.stringify(mocks.projectApiToken.findUnique.mock.calls[0][0])).not.toContain(SECRET);
  });

  it.each([
    [null, 401, 'AUTH_REQUIRED'],
    ['Basic abc', 401, 'AUTH_INVALID'],
    ['Bearer wrong-shape', 401, 'AUTH_INVALID'],
  ])('rejects malformed authorization without a database lookup', async (header, status, code) => {
    const result = await authenticateDeveloperApi(request(header), PROJECT_ID, 'issues:read');
    expect(result).toMatchObject({ ok: false, status, code });
    expect(mocks.projectApiToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing, wrong-project, revoked, expired, and wrong-scope tokens uniformly', async () => {
    const invalidRows = [
      null,
      { id: 't', projectId: 'other', scope: 'issues:read', expiresAt: null, revokedAt: null, project: {} },
      { id: 't', projectId: PROJECT_ID, scope: 'issues:read', expiresAt: null, revokedAt: new Date(), project: {} },
      { id: 't', projectId: PROJECT_ID, scope: 'issues:read', expiresAt: new Date('2020-01-01'), revokedAt: null, project: {} },
      { id: 't', projectId: PROJECT_ID, scope: 'other', expiresAt: null, revokedAt: null, project: {} },
    ];
    for (const row of invalidRows) {
      mocks.projectApiToken.findUnique.mockResolvedValueOnce(row);
      const result = await authenticateDeveloperApi(request(), PROJECT_ID, 'issues:read');
      expect(result).toMatchObject({ ok: false, status: 401, code: 'AUTH_INVALID' });
    }
  });

  it('returns a bounded rate-limit response for a valid token', async () => {
    mocks.projectApiToken.findUnique.mockResolvedValue({
      id: 'token-1', projectId: PROJECT_ID, scope: 'issues:read', expiresAt: null, revokedAt: null, project: {},
    });
    mocks.consume.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 10 } as ReturnType<typeof mocks.consume>);
    expect(await authenticateDeveloperApi(request(), PROJECT_ID, 'issues:read')).toMatchObject({
      ok: false, status: 429, code: 'RATE_LIMITED', retryAfterSec: 10,
    });
  });
});
