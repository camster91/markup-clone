// requireProjectKey: a dashboard session only replaces the widget API key
// when the session's user can access the target project.
//
// Before this, any valid session + dashboard Origin skipped the key for any
// projectId, so a guest in team A could create pins and annotations in team
// B's project (project ids are public — they sit in the widget snippet).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  sessionFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  assertProjectAccessible: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    project: { findUnique: mocks.projectFindUnique },
  },
}));
vi.mock('@/lib/teams', () => ({
  assertProjectAccessible: mocks.assertProjectAccessible,
}));

import { requireProjectKey } from '@/lib/auth';

function dashboardReq(headers: Record<string, string> = {}): Request {
  return new Request('https://markup.ashbi.ca/api/pins', {
    method: 'POST',
    headers: { origin: 'https://markup.ashbi.ca', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DASHBOARD_HOST = 'markup.ashbi.ca';
  mocks.cookieGet.mockReturnValue({ value: 'session-token' });
  mocks.sessionFindUnique.mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: 'user-a', email: 'guest@team-a.example', role: 'reviewer' },
  });
});

describe('requireProjectKey with a dashboard session', () => {
  it('allows a session whose user can access the project', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({ ok: true });
    const res = await requireProjectKey(dashboardReq(), PROJECT_ID);
    expect(res).toBeNull();
    expect(mocks.assertProjectAccessible).toHaveBeenCalledWith(PROJECT_ID);
    // No widget key lookup needed on the session path.
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a session from another team when no API key is sent", async () => {
    mocks.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not a member of this project's team",
    });
    const res = await requireProjectKey(dashboardReq(), PROJECT_ID);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect((await res!.json()).error).toBe('Missing X-Api-Key');
  });

  it('still accepts the correct project API key when the session lacks access', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not a member of this project's team",
    });
    mocks.projectFindUnique.mockResolvedValue({ apiKey: 'mk_projectkey' });
    const res = await requireProjectKey(
      dashboardReq({ 'x-api-key': 'mk_projectkey' }),
      PROJECT_ID
    );
    expect(res).toBeNull();
  });

  it('skips the membership lookup when there is no session', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await requireProjectKey(dashboardReq(), PROJECT_ID);
    expect(res!.status).toBe(401);
    expect(mocks.assertProjectAccessible).not.toHaveBeenCalled();
  });
});
