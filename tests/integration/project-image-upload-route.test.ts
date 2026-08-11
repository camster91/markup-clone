import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  page: { create: vi.fn() },
  screenshot: { create: vi.fn() },
  transaction: vi.fn(),
  requireDashboardAuth: vi.fn(),
  requireCsrfToken: vi.fn(),
  assertProjectAdmin: vi.fn(),
  consume: vi.fn(),
  audit: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: mocks.page,
    screenshot: mocks.screenshot,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/auth', () => ({ requireDashboardAuth: mocks.requireDashboardAuth }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: mocks.requireCsrfToken }));
vi.mock('@/lib/teams', () => ({ assertProjectAdmin: mocks.assertProjectAdmin }));
vi.mock('@/lib/rate-limit', () => ({ consume: mocks.consume }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink }));

import { POST } from '@/app/api/projects/[id]/images/route';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PAGE_ID = '22222222-2222-2222-2222-222222222222';
const SCREENSHOT_ID = '33333333-3333-3333-3333-333333333333';
const CSRF_TOKEN = 'test-csrf-token';
const params = { params: Promise.resolve({ id: PROJECT_ID }) };

function png(width = 640, height = 480): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes.buffer;
}

function request(file: File): Request {
  const form = new FormData();
  form.set('file', file);
  return new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/images`, {
    method: 'POST',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDashboardAuth.mockResolvedValue(null);
  mocks.requireCsrfToken.mockReturnValue(null);
  mocks.assertProjectAdmin.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    caller: { id: 'owner-1', email: 'owner@example.com', role: 'operator' },
    membershipRole: 'operator',
  });
  mocks.consume.mockReturnValue({ ok: true });
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback) => callback({
    page: mocks.page,
    screenshot: mocks.screenshot,
  }));
  mocks.page.create.mockResolvedValue({ id: PAGE_ID, path: '/uploads/mock.png' });
  mocks.screenshot.create.mockResolvedValue({
    id: SCREENSHOT_ID,
    pageId: PAGE_ID,
    storageKey: `${SCREENSHOT_ID}.png`,
    mimeType: 'image/png',
    width: 640,
    height: 480,
    capturedAt: new Date('2026-08-10T12:00:00.000Z'),
  });
});

describe('POST /api/projects/[id]/images', () => {
  it('creates a normal review page and screenshot for a valid administrator PNG upload', async () => {
    const response = await POST(request(new File([png()], 'homepage.png', { type: 'image/png' })), params);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        pageId: PAGE_ID,
        screenshot: {
          id: SCREENSHOT_ID,
          mimeType: 'image/png',
          width: 640,
          height: 480,
        },
      },
    });
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.page.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: PROJECT_ID }),
      select: { id: true, path: true },
    });
    expect(mocks.screenshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pageId: PAGE_ID, mimeType: 'image/png', width: 640, height: 480 }),
      select: expect.any(Object),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'owner@example.com',
      action: 'project.image.upload',
      target: SCREENSHOT_ID,
    }));
  });

  it('rejects unsupported files before writing bytes', async () => {
    const response = await POST(request(new File(['<svg />'], 'unsafe.svg', { type: 'image/svg+xml' })), params);

    expect(response.status).toBe(415);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects non-administrators before reading the multipart body', async () => {
    mocks.assertProjectAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Owner or operator role required' });

    const response = await POST(request(new File([png()], 'homepage.png', { type: 'image/png' })), params);

    expect(response.status).toBe(403);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rate limits image uploads before reading or storing the multipart body', async () => {
    mocks.consume.mockReturnValue({ ok: false, retryAfterSec: 10 });

    const response = await POST(request(new File([png()], 'homepage.png', { type: 'image/png' })), params);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
