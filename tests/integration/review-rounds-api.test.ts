import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '22222222-2222-4222-8222-222222222222';
const SIGN_OFF_ID = '33333333-3333-4333-8333-333333333333';
const CSRF = 'review-round-csrf';

const mocks = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'contributor' | 'client' | 'guest',
  project: { findUnique: vi.fn(), update: vi.fn() },
  reviewRound: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn() },
  reviewSignOff: { upsert: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: mocks.project,
    reviewRound: mocks.reviewRound,
    reviewSignOff: mocks.reviewSignOff,
    auditLog: mocks.auditLog,
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireDashboardAuth: vi.fn(async (req: Request) => actual.requireDashboardOrigin(req)),
  };
});

vi.mock('@/lib/teams', () => ({
  canSignOffProject: (role: string) => role !== 'guest',
  assertProjectAccessible: vi.fn(async () => ({
    ok: true,
    projectId: PROJECT_ID,
    teamId: 'team-1',
    caller: { id: 'user-1', email: 'reviewer@example.com', role: 'reviewer' },
    membershipRole: mocks.role,
  })),
  assertProjectAdmin: vi.fn(async () =>
    mocks.role === 'owner'
      ? {
          ok: true,
          projectId: PROJECT_ID,
          teamId: 'team-1',
          caller: { id: 'user-1', email: 'owner@example.com', role: 'reviewer' },
          membershipRole: 'owner',
        }
      : { ok: false, status: 403, error: 'Owner or operator role required' }
  ),
}));

import { GET, POST } from '@/app/api/projects/[id]/review-rounds/route';
import { PATCH } from '@/app/api/projects/[id]/review-rounds/[roundId]/route';
import { POST as signOff } from '@/app/api/projects/[id]/review-rounds/[roundId]/sign-offs/route';
import { DELETE as withdraw } from '@/app/api/projects/[id]/review-rounds/[roundId]/sign-offs/[signOffId]/route';

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`https://markup.ashbi.ca${path}`, {
    method,
    headers: {
      Origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF,
      cookie: `markup.csrf=${CSRF}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const baseParams = { params: Promise.resolve({ id: PROJECT_ID }) };
const roundParams = { params: Promise.resolve({ id: PROJECT_ID, roundId: ROUND_ID }) };
const signOffParams = {
  params: Promise.resolve({ id: PROJECT_ID, roundId: ROUND_ID, signOffId: SIGN_OFF_ID }),
};

const round = {
  id: ROUND_ID,
  projectId: PROJECT_ID,
  number: 1,
  name: 'Launch review',
  status: 'IN_REVIEW',
  commentsPaused: false,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-07T12:00:00Z'),
  updatedAt: new Date('2026-08-07T12:00:00Z'),
  _count: { pins: 2 },
  signOffs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'owner';
  mocks.project.findUnique.mockResolvedValue({
    activeReviewRoundId: ROUND_ID,
    team: { reviewRoundNameTemplate: 'Client QA {n}', reviewRoundCommentsPaused: true },
  });
  mocks.reviewRound.findMany.mockResolvedValue([round]);
  mocks.reviewRound.findFirst.mockResolvedValue(round);
  mocks.reviewRound.aggregate.mockResolvedValue({ _max: { number: 0 } });
  mocks.reviewRound.create.mockResolvedValue(round);
  mocks.reviewRound.update.mockResolvedValue({ ...round, commentsPaused: true });
  mocks.project.update.mockResolvedValue({ id: PROJECT_ID });
  mocks.reviewSignOff.upsert.mockResolvedValue({
    id: SIGN_OFF_ID,
    userId: 'user-1',
    signerEmail: 'reviewer@example.com',
    note: 'Approved',
    createdAt: new Date('2026-08-07T13:00:00Z'),
  });
  mocks.reviewSignOff.findFirst.mockResolvedValue({ id: SIGN_OFF_ID, userId: 'user-1' });
  mocks.reviewSignOff.delete.mockResolvedValue({ id: SIGN_OFF_ID });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({ project: mocks.project, reviewRound: mocks.reviewRound })
  );
});

describe('review round APIs', () => {
  it('returns bounded round data to a project reviewer', async () => {
    mocks.role = 'client';
    const response = await GET(request(`/api/projects/${PROJECT_ID}/review-rounds`), baseParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activeReviewRoundId).toBe(ROUND_ID);
    expect(body.rounds[0]).toMatchObject({ id: ROUND_ID, number: 1, pinCount: 2, isActive: true });
    expect(body.rounds[0]).not.toHaveProperty('projectId');
    expect(body.rounds[0]).not.toHaveProperty('createdBy');
    expect(body).not.toHaveProperty('defaults');
  });

  it('returns the next reusable client-account defaults only to administrators', async () => {
    const response = await GET(request(`/api/projects/${PROJECT_ID}/review-rounds`), baseParams);
    const body = await response.json();
    expect(body.defaults).toEqual({ suggestedName: 'Client QA 2', commentsPaused: true });
  });

  it('blocks a reviewer from creating a round', async () => {
    mocks.role = 'client';
    const response = await POST(request(`/api/projects/${PROJECT_ID}/review-rounds`, 'POST', { name: 'Round 2' }), baseParams);
    expect(response.status).toBe(403);
    expect(mocks.reviewRound.create).not.toHaveBeenCalled();
  });

  it('creates the next numbered round and makes it active atomically', async () => {
    const response = await POST(request(`/api/projects/${PROJECT_ID}/review-rounds`, 'POST', { name: ' Launch review ' }), baseParams);
    expect(response.status).toBe(201);
    expect(mocks.reviewRound.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: PROJECT_ID, number: 1, name: 'Launch review', createdBy: 'user-1' }),
    }));
    expect(mocks.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { activeReviewRoundId: ROUND_ID },
    });
  });

  it('applies client-account defaults when the administrator keeps the suggested name', async () => {
    const response = await POST(request(`/api/projects/${PROJECT_ID}/review-rounds`, 'POST', { name: '' }), baseParams);
    expect(response.status).toBe(201);
    expect(mocks.reviewRound.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Client QA 1', commentsPaused: true }),
    }));
  });

  it('validates status transitions and blocks reviewer management', async () => {
    mocks.reviewRound.findFirst.mockResolvedValue({ ...round, status: 'DRAFT' });
    let response = await PATCH(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}`, 'PATCH', { status: 'APPROVED' }), roundParams);
    expect(response.status).toBe(409);

    mocks.role = 'client';
    response = await PATCH(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}`, 'PATCH', { commentsPaused: true }), roundParams);
    expect(response.status).toBe(403);
  });

  it('does not let an administrator mutate a historical round', async () => {
    mocks.project.findUnique.mockResolvedValue({ activeReviewRoundId: '44444444-4444-4444-8444-444444444444' });
    const response = await PATCH(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}`, 'PATCH', { commentsPaused: true }), roundParams);
    expect(response.status).toBe(409);
    expect(mocks.reviewRound.update).not.toHaveBeenCalled();
  });

  it('updates allowed fields and clears the active pointer when archived', async () => {
    mocks.reviewRound.update.mockResolvedValue({ ...round, status: 'ARCHIVED' });
    const response = await PATCH(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}`, 'PATCH', { status: 'ARCHIVED' }), roundParams);
    expect(response.status).toBe(200);
    expect(mocks.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { activeReviewRoundId: null },
    });
  });

  it('allows a reviewer to create or update only their own sign-off', async () => {
    mocks.role = 'client';
    const response = await signOff(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}/sign-offs`, 'POST', { note: ' Approved ' }), roundParams);
    expect(response.status).toBe(200);
    expect(mocks.reviewSignOff.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { reviewRoundId_userId: { reviewRoundId: ROUND_ID, userId: 'user-1' } },
      create: expect.objectContaining({ userId: 'user-1', signerEmail: 'reviewer@example.com', note: 'Approved' }),
    }));
  });

  it('does not let a reviewer sign off a historical round', async () => {
    mocks.role = 'client';
    mocks.project.findUnique.mockResolvedValue({ activeReviewRoundId: '44444444-4444-4444-8444-444444444444' });
    const response = await signOff(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}/sign-offs`, 'POST', {}), roundParams);
    expect(response.status).toBe(409);
    expect(mocks.reviewSignOff.upsert).not.toHaveBeenCalled();
  });

  it('prevents withdrawing another reviewer sign-off without admin rights', async () => {
    mocks.role = 'client';
    mocks.reviewSignOff.findFirst.mockResolvedValue({ id: SIGN_OFF_ID, userId: 'someone-else' });
    const response = await withdraw(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}/sign-offs/${SIGN_OFF_ID}`, 'DELETE'), signOffParams);
    expect(response.status).toBe(403);
    expect(mocks.reviewSignOff.delete).not.toHaveBeenCalled();
  });

  it('withdraws the caller own sign-off', async () => {
    mocks.role = 'client';
    const response = await withdraw(request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}/sign-offs/${SIGN_OFF_ID}`, 'DELETE'), signOffParams);
    expect(response.status).toBe(200);
    expect(mocks.reviewSignOff.delete).toHaveBeenCalledWith({ where: { id: SIGN_OFF_ID } });
  });

  it('does not allow a project-scoped guest to sign off', async () => {
    mocks.role = 'guest';
    const response = await signOff(
      request(`/api/projects/${PROJECT_ID}/review-rounds/${ROUND_ID}/sign-offs`, 'POST', {}),
      roundParams,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Client sign-off role required' });
    expect(mocks.reviewSignOff.upsert).not.toHaveBeenCalled();
  });
});
