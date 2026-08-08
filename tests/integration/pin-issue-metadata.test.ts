import { beforeEach, describe, expect, it, vi } from 'vitest';

const PIN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const ASSIGNEE_ID = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  pin: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  screenshot: { findUnique: vi.fn(), delete: vi.fn() },
  teamMember: { findFirst: vi.fn() },
  audit: vi.fn(),
  accessible: vi.fn(),
  admin: vi.fn(),
  sendProjectMemberNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/auth', () => ({ requireDashboardAuth: vi.fn(async () => null) }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: vi.fn(() => null) }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/teams', () => ({
  assertProjectAccessible: mocks.accessible,
  assertProjectAdmin: mocks.admin,
}));
vi.mock('@/lib/project-notification-delivery', () => ({
  sendProjectMemberNotification: mocks.sendProjectMemberNotification,
}));
vi.mock('fs/promises', () => ({ unlink: vi.fn() }));

import { PATCH } from '@/app/api/pins/[id]/route';

function request(body: unknown) {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: PIN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pin.findUnique.mockResolvedValue({
    status: 'OPEN',
    assigneeId: null,
    screenshot: { page: { projectId: PROJECT_ID } },
  });
  mocks.accessible.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    caller: { id: 'reviewer', email: 'reviewer@example.com', role: 'reviewer' },
    membershipRole: 'reviewer',
  });
  mocks.admin.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    caller: { id: 'owner', email: 'owner@example.com', role: 'reviewer' },
    membershipRole: 'owner',
  });
  mocks.teamMember.findFirst.mockResolvedValue({
    userId: ASSIGNEE_ID,
    user: { id: ASSIGNEE_ID, email: 'dev@example.com' },
  });
  mocks.pin.update.mockResolvedValue({
    id: PIN_ID,
    status: 'OPEN',
    priority: 'HIGH',
    assignee: { id: ASSIGNEE_ID, email: 'dev@example.com' },
    tags: [
      { tag: { id: 'tag-1', name: 'Front End', key: 'front end' } },
      { tag: { id: 'tag-2', name: 'QA', key: 'qa' } },
    ],
  });
});

describe('PATCH /api/pins/[id] internal issue metadata', () => {
  it('keeps status-only updates available to an authorized reviewer without leaking metadata', async () => {
    const response = await PATCH(request({ status: 'RESOLVED' }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.pin.update).toHaveBeenCalledWith({
      where: { id: PIN_ID },
      data: { status: 'RESOLVED' },
      select: { id: true, status: true },
    });
    expect(body.data).toEqual({ id: PIN_ID, status: 'OPEN' });
    expect(body.data).not.toHaveProperty('priority');
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pinId: PIN_ID,
      event: 'status-change',
      title: 'Feedback resolved',
      message: 'reviewer@example.com marked feedback as resolved.',
      actorUserId: 'reviewer',
    });
  });

  it('blocks a reviewer from changing internal metadata before any write', async () => {
    mocks.admin.mockResolvedValue({ ok: false, status: 403, error: 'Owner or operator role required' });

    const response = await PATCH(request({ priority: 'URGENT' }), params);

    expect(response.status).toBe(403);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });

  it('atomically replaces normalized tags and updates an eligible team assignee', async () => {
    const response = await PATCH(request({
      priority: 'HIGH',
      assigneeId: ASSIGNEE_ID,
      tagNames: [' Front End ', 'front   end', 'QA'],
    }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.teamMember.findFirst).toHaveBeenCalledWith({
      where: { teamId: TEAM_ID, userId: ASSIGNEE_ID },
      select: { userId: true, user: { select: { id: true, email: true } } },
    });
    expect(mocks.pin.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: PIN_ID },
      data: expect.objectContaining({
        priority: 'HIGH',
        assigneeId: ASSIGNEE_ID,
        tags: {
          deleteMany: {},
          create: [
            { tag: { connectOrCreate: {
              where: { projectId_key: { projectId: PROJECT_ID, key: 'front end' } },
              create: { projectId: PROJECT_ID, name: 'Front End', key: 'front end' },
            } } },
            { tag: { connectOrCreate: {
              where: { projectId_key: { projectId: PROJECT_ID, key: 'qa' } },
              create: { projectId: PROJECT_ID, name: 'QA', key: 'qa' },
            } } },
          ],
        },
      }),
    }));
    expect(body.data).toEqual({
      id: PIN_ID,
      status: 'OPEN',
      priority: 'HIGH',
      assignee: { id: ASSIGNEE_ID, email: 'dev@example.com' },
      tags: [
        { id: 'tag-1', name: 'Front End', key: 'front end' },
        { id: 'tag-2', name: 'QA', key: 'qa' },
      ],
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'owner@example.com', action: 'pin.update', target: PIN_ID,
    }));
    expect(mocks.sendProjectMemberNotification).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pinId: PIN_ID,
      event: 'assignment',
      title: 'Feedback assigned to you',
      message: 'owner@example.com assigned feedback to you.',
      actorUserId: 'owner',
      targetUserIds: [ASSIGNEE_ID],
    });
  });

  it('does not resend assignment email when the assignee did not change', async () => {
    mocks.pin.findUnique.mockResolvedValue({
      status: 'OPEN',
      assigneeId: ASSIGNEE_ID,
      screenshot: { page: { projectId: PROJECT_ID } },
    });
    const response = await PATCH(request({ assigneeId: ASSIGNEE_ID }), params);
    expect(response.status).toBe(200);
    expect(mocks.sendProjectMemberNotification).not.toHaveBeenCalled();
  });

  it('rejects an assignee who is pending, outside the project team, or assigned on a legacy project', async () => {
    mocks.teamMember.findFirst.mockResolvedValue(null);
    const outside = await PATCH(request({ assigneeId: ASSIGNEE_ID }), params);
    expect(outside.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();

    mocks.admin.mockResolvedValue({
      ok: true,
      projectId: PROJECT_ID,
      teamId: null,
      caller: { id: 'operator', email: 'operator@example.com', role: 'operator' },
      membershipRole: 'operator',
    });
    const legacy = await PATCH(request({ assigneeId: ASSIGNEE_ID }), params);
    expect(legacy.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });

  it('rejects invalid priority and tag payloads before writing', async () => {
    const priority = await PATCH(request({ priority: 'BLOCKER' }), params);
    const tags = await PATCH(request({ tagNames: ['one', 'two', 'three', 'four', 'five', 'six'] }), params);

    expect(priority.status).toBe(400);
    expect(tags.status).toBe(400);
    expect(mocks.pin.update).not.toHaveBeenCalled();
  });
});
