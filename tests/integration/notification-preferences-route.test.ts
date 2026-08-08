import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  assertProjectAccessible: vi.fn(),
  requireDashboardAuth: vi.fn(),
  requireCsrfToken: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectNotificationPreference: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));
vi.mock('@/lib/teams', () => ({ assertProjectAccessible: mocks.assertProjectAccessible }));
vi.mock('@/lib/auth', () => ({ requireDashboardAuth: mocks.requireDashboardAuth }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: mocks.requireCsrfToken }));

import { GET, PATCH } from '@/app/api/projects/[id]/notification-preferences/route';

const params = { params: Promise.resolve({ id: PROJECT_ID }) };
const preferences = {
  newPinEmail: true,
  newCommentEmail: false,
  statusChangeEmail: true,
  assignmentEmail: true,
  mentionEmail: true,
};
const preferenceSelect = {
  newPinEmail: true,
  newCommentEmail: true,
  statusChangeEmail: true,
  assignmentEmail: true,
  mentionEmail: true,
};

function request(method: 'GET' | 'PATCH', body?: unknown) {
  return new NextRequest(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/notification-preferences`, {
    method,
    headers: {
      Origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-token',
      cookie: 'markup.csrf=csrf-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDashboardAuth.mockResolvedValue(null);
  mocks.requireCsrfToken.mockReturnValue(null);
  mocks.assertProjectAccessible.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: 'team-1',
    caller: { id: USER_ID, email: 'owner@example.com', role: 'reviewer' },
    membershipRole: 'owner',
  });
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({ id: 'preference-1', ...preferences });
});

describe('project notification preference API', () => {
  it('returns safe defaults and the caller role recommendation when no row exists', async () => {
    const response = await GET(request('GET'), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      saved: false,
      role: 'owner',
      preferences: {
        newPinEmail: false,
        newCommentEmail: false,
        statusChangeEmail: false,
        assignmentEmail: false,
        mentionEmail: true,
      },
      recommended: preferences,
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      select: preferenceSelect,
    });
  });

  it('returns only preference booleans from the caller-owned row', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'private-id', userId: USER_ID, ...preferences });
    const response = await GET(request('GET'), params);
    const body = await response.json();
    expect(body).toMatchObject({ saved: true, role: 'owner', preferences });
    expect(JSON.stringify(body)).not.toContain('private-id');
    expect(JSON.stringify(body)).not.toContain(USER_ID);
  });

  it('upserts only the signed-in caller preference and never accepts a body user id', async () => {
    const response = await PATCH(request('PATCH', preferences), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true, role: 'owner', preferences });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      create: { projectId: PROJECT_ID, userId: USER_ID, ...preferences },
      update: preferences,
      select: preferenceSelect,
    });

    const injected = await PATCH(request('PATCH', { ...preferences, userId: 'attacker' }), params);
    expect(injected.status).toBe(400);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it('requires CSRF and project membership before reading or writing preferences', async () => {
    mocks.requireCsrfToken.mockReturnValueOnce(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
    expect((await PATCH(request('PATCH', preferences), params)).status).toBe(403);

    mocks.assertProjectAccessible.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    expect((await GET(request('GET'), params)).status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed project ids before authorization and database access', async () => {
    const badParams = { params: Promise.resolve({ id: 'not-a-uuid' }) };
    const response = await GET(request('GET'), badParams);
    expect(response.status).toBe(400);
    expect(mocks.assertProjectAccessible).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
