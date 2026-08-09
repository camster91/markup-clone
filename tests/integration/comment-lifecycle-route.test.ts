import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pin: { findUnique: vi.fn() },
  comment: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  audit: vi.fn(),
  consume: vi.fn(),
  requireDashboardAuth: vi.fn(),
  requireCsrfToken: vi.fn(),
  assertProjectAdmin: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { pin: mocks.pin, comment: mocks.comment } }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/rate-limit', () => ({ consume: mocks.consume }));
vi.mock('@/lib/auth', () => ({ requireDashboardAuth: mocks.requireDashboardAuth }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: mocks.requireCsrfToken }));
vi.mock('@/lib/teams', () => ({ assertProjectAdmin: mocks.assertProjectAdmin }));

import { DELETE, PATCH } from '@/app/api/pins/[id]/comments/[commentId]/route';

const PIN_ID = '11111111-1111-1111-1111-111111111111';
const COMMENT_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const CSRF_TOKEN = 'test-csrf-token';
const params = { params: Promise.resolve({ id: PIN_ID, commentId: COMMENT_ID }) };

function request(method: 'PATCH' | 'DELETE', body?: unknown): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}/comments/${COMMENT_ID}`, {
    method,
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDashboardAuth.mockResolvedValue(null);
  mocks.requireCsrfToken.mockReturnValue(null);
  mocks.consume.mockReturnValue({ ok: true });
  mocks.pin.findUnique.mockResolvedValue({
    screenshot: { page: { projectId: PROJECT_ID } },
  });
  mocks.assertProjectAdmin.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    caller: { id: 'user-1', email: 'owner@example.com', role: 'operator' },
    membershipRole: 'operator',
  });
  mocks.comment.findFirst.mockResolvedValue({
    id: COMMENT_ID,
    pinId: PIN_ID,
    text: 'Original feedback',
    author: 'Client',
    authorRole: 'client',
    createdAt: new Date('2026-08-09T12:00:00.000Z'),
  });
  mocks.comment.update.mockResolvedValue({
    id: COMMENT_ID,
    pinId: PIN_ID,
    text: 'Updated feedback',
    author: 'Client',
    authorRole: 'client',
    createdAt: new Date('2026-08-09T12:00:00.000Z'),
  });
  mocks.comment.delete.mockResolvedValue({ id: COMMENT_ID });
});

describe('comment lifecycle route', () => {
  it('lets a project administrator edit a comment and records the audit event', async () => {
    const response = await PATCH(request('PATCH', { text: 'Updated feedback' }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: COMMENT_ID, text: 'Updated feedback' },
    });
    expect(mocks.comment.update).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
      data: { text: 'Updated feedback' },
    });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'owner@example.com',
      action: 'comment.update',
      target: COMMENT_ID,
      metadata: { pinId: PIN_ID },
    });
  });

  it('rejects empty edited text before looking up or changing the comment', async () => {
    const response = await PATCH(request('PATCH', { text: '   ' }), params);

    expect(response.status).toBe(400);
    expect(mocks.comment.findFirst).not.toHaveBeenCalled();
    expect(mocks.comment.update).not.toHaveBeenCalled();
  });

  it('does not edit a comment that belongs to a different pin', async () => {
    mocks.comment.findFirst.mockResolvedValue(null);

    const response = await PATCH(request('PATCH', { text: 'Updated feedback' }), params);

    expect(response.status).toBe(404);
    expect(mocks.comment.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('lets a project administrator delete only a comment in the current pin and audits it', async () => {
    const response = await DELETE(request('DELETE'), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.comment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'owner@example.com',
      action: 'comment.delete',
      target: COMMENT_ID,
      metadata: { pinId: PIN_ID },
    });
  });

  it('refuses mutations when the caller is not a project administrator', async () => {
    mocks.assertProjectAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Owner or operator role required' });

    const response = await DELETE(request('DELETE'), params);

    expect(response.status).toBe(403);
    expect(mocks.comment.findFirst).not.toHaveBeenCalled();
    expect(mocks.comment.delete).not.toHaveBeenCalled();
  });
});
