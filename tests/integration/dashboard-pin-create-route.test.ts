import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireDashboardAuth: vi.fn(),
  requireCsrfToken: vi.fn(),
  assertProjectAccessible: vi.fn(),
  consume: vi.fn(),
  audit: vi.fn(),
  emit: vi.fn(),
  sendSubscriberEmails: vi.fn(),
  sendProjectMemberNotification: vi.fn(),
  screenshot: { findFirst: vi.fn() },
  project: { findUnique: vi.fn() },
  pin: { create: vi.fn() },
  subscriber: { findMany: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireDashboardAuth: mocks.requireDashboardAuth }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: mocks.requireCsrfToken }));
vi.mock('@/lib/teams', () => ({ assertProjectAccessible: mocks.assertProjectAccessible }));
vi.mock('@/lib/rate-limit', () => ({ consume: mocks.consume }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/events', () => ({ emit: mocks.emit }));
vi.mock('@/lib/email', () => ({ sendSubscriberEmails: mocks.sendSubscriberEmails }));
vi.mock('@/lib/project-notification-delivery', () => ({ sendProjectMemberNotification: mocks.sendProjectMemberNotification }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  screenshot: mocks.screenshot,
  project: mocks.project,
  pin: mocks.pin,
  subscriber: mocks.subscriber,
} }));

import { POST } from '@/app/api/projects/[id]/screenshots/[screenshotId]/pins/route';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const SCREENSHOT_ID = '22222222-2222-2222-2222-222222222222';
const CSRF_TOKEN = 'test-csrf-token';
const context = { params: Promise.resolve({ id: PROJECT_ID, screenshotId: SCREENSHOT_ID }) };

function request(body: unknown): Request {
  return new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/screenshots/${SCREENSHOT_ID}/pins`, {
    method: 'POST',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'content-type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDashboardAuth.mockResolvedValue(null);
  mocks.requireCsrfToken.mockReturnValue(null);
  mocks.consume.mockReturnValue({ ok: true });
  mocks.assertProjectAccessible.mockResolvedValue({
    ok: true,
    caller: { id: 'reviewer-1', email: 'reviewer@example.com', role: 'reviewer' },
    membershipRole: 'client',
  });
  mocks.screenshot.findFirst.mockResolvedValue({ id: SCREENSHOT_ID, page: { path: '/documents/asset/pages/001' } });
  mocks.project.findUnique.mockResolvedValue({
    id: PROJECT_ID,
    name: 'PDF review',
    archivedAt: null,
    activeReviewRoundId: null,
    activeReviewRound: null,
  });
  mocks.pin.create.mockResolvedValue({
    id: '33333333-3333-3333-3333-333333333333',
    screenshotId: SCREENSHOT_ID,
    xPercent: 25,
    yPercent: 40,
    status: 'OPEN',
    priority: 'NONE',
    authorName: 'Client reviewer',
    createdAt: new Date('2026-08-28T15:00:00.000Z'),
    comments: [{
      id: '44444444-4444-4444-4444-444444444444',
      text: 'Please revise this heading',
      author: 'Client reviewer',
      authorRole: 'reviewer',
      createdAt: new Date('2026-08-28T15:00:00.000Z'),
    }],
  });
  mocks.subscriber.findMany.mockResolvedValue([]);
  mocks.sendSubscriberEmails.mockResolvedValue(undefined);
  mocks.sendProjectMemberNotification.mockResolvedValue(undefined);
});

describe('POST dashboard pin on an existing screenshot', () => {
  it('lets an authorized project reviewer add a normal pin and initial thread', async () => {
    const response = await POST(request({ xPercent: 25, yPercent: 40, text: 'Please revise this heading', authorName: 'Client reviewer' }), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { xPercent: 25, yPercent: 40, comments: [{ text: 'Please revise this heading' }], annotations: [] },
    });
    expect(mocks.screenshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: SCREENSHOT_ID, page: { projectId: PROJECT_ID } },
    }));
    expect(mocks.pin.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ screenshotId: SCREENSHOT_ID, xPercent: 25, yPercent: 40 }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'pin.create' }));
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'new-pin', projectId: PROJECT_ID }));
  });

  it('enforces CSRF and rate limiting before project data access', async () => {
    mocks.requireCsrfToken.mockReturnValueOnce(new Response(null, { status: 403 }));
    expect((await POST(request({}), context)).status).toBe(403);
    expect(mocks.consume).not.toHaveBeenCalled();

    mocks.consume.mockReturnValueOnce({ ok: false, retryAfterSec: 10 });
    const limited = await POST(request({}), context);
    expect(limited.status).toBe(429);
    expect(mocks.assertProjectAccessible).not.toHaveBeenCalled();
    expect(mocks.screenshot.findFirst).not.toHaveBeenCalled();
  });

  it('rejects unauthorized projects, invalid coordinates, and cross-project screenshots', async () => {
    mocks.assertProjectAccessible.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    expect((await POST(request({ xPercent: 25, yPercent: 40, text: 'No access' }), context)).status).toBe(403);

    expect((await POST(request({ xPercent: 101, yPercent: 40, text: 'Outside' }), context)).status).toBe(400);

    mocks.screenshot.findFirst.mockResolvedValueOnce(null);
    expect((await POST(request({ xPercent: 25, yPercent: 40, text: 'Wrong project' }), context)).status).toBe(404);
    expect(mocks.pin.create).not.toHaveBeenCalled();
  });

  it('honors archived and paused review-round gates', async () => {
    mocks.project.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID, name: 'PDF review', archivedAt: new Date(), activeReviewRoundId: null, activeReviewRound: null,
    });
    expect((await POST(request({ xPercent: 25, yPercent: 40, text: 'Archived' }), context)).status).toBe(409);

    mocks.project.findUnique.mockResolvedValueOnce({
      id: PROJECT_ID, name: 'PDF review', archivedAt: null, activeReviewRoundId: 'round-1', activeReviewRound: { commentsPaused: true },
    });
    expect((await POST(request({ xPercent: 25, yPercent: 40, text: 'Paused' }), context)).status).toBe(409);
    expect(mocks.pin.create).not.toHaveBeenCalled();
  });
});
