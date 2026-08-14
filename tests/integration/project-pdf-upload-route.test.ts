import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reviewDocument: { create: vi.fn() }, page: { create: vi.fn() }, screenshot: { create: vi.fn() }, transaction: vi.fn(),
  requireDashboardAuth: vi.fn(), requireCsrfToken: vi.fn(), assertProjectAdmin: vi.fn(), consume: vi.fn(), audit: vi.fn(),
  mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn(), renderPdfPages: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { reviewDocument: mocks.reviewDocument, page: mocks.page, screenshot: mocks.screenshot, $transaction: mocks.transaction } }));
vi.mock('@/lib/auth', () => ({ requireDashboardAuth: mocks.requireDashboardAuth }));
vi.mock('@/lib/csrf', () => ({ requireCsrfToken: mocks.requireCsrfToken }));
vi.mock('@/lib/teams', () => ({ assertProjectAdmin: mocks.assertProjectAdmin }));
vi.mock('@/lib/rate-limit', () => ({ consume: mocks.consume }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/pdf-renderer', () => ({ assertPdfHeader: vi.fn(), renderPdfPages: mocks.renderPdfPages }));
vi.mock('fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink }));

import { POST } from '@/app/api/projects/[id]/documents/route';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const params = { params: Promise.resolve({ id: PROJECT_ID }) };
function request(file: File) {
  const form = new FormData(); form.set('file', file);
  return new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/documents`, { method: 'POST', headers: { origin: 'https://markup.ashbi.ca', 'X-CSRF-Token': 'csrf', cookie: 'markup.csrf=csrf' }, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireDashboardAuth.mockResolvedValue(null); mocks.requireCsrfToken.mockReturnValue(null);
  mocks.assertProjectAdmin.mockResolvedValue({ ok: true, projectId: PROJECT_ID, caller: { email: 'owner@example.com' } });
  mocks.consume.mockReturnValue({ ok: true }); mocks.mkdir.mockResolvedValue(undefined); mocks.writeFile.mockResolvedValue(undefined); mocks.unlink.mockResolvedValue(undefined);
  mocks.renderPdfPages.mockResolvedValue([{ bytes: Buffer.from('png-1'), width: 640, height: 480 }, { bytes: Buffer.from('png-2'), width: 640, height: 480 }]);
  let pageNumber = 0;
  mocks.transaction.mockImplementation(async (callback) => callback({ reviewDocument: mocks.reviewDocument, page: mocks.page, screenshot: mocks.screenshot }));
  mocks.reviewDocument.create.mockResolvedValue({ id: 'document-1' });
  mocks.page.create.mockImplementation(async () => ({ id: `page-${++pageNumber}` }));
  mocks.screenshot.create.mockImplementation(async ({ data }) => ({ ...data, capturedAt: new Date('2026-08-11T00:00:00.000Z') }));
});

describe('POST /api/projects/[id]/documents', () => {
  it('renders a scoped administrator PDF into ordinary review screenshots', async () => {
    const response = await POST(request(new File(['%PDF-1.7'], 'design.pdf', { type: 'application/pdf' })), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, data: { pages: [{ width: 640, height: 480 }, { width: 640, height: 480 }] } });
    expect(mocks.writeFile).toHaveBeenCalledTimes(3);
    expect(mocks.reviewDocument.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ storageKey: expect.stringMatching(/^[0-9a-f-]+\.pdf$/), pageCount: 2 }) }));
    expect(mocks.page.create).toHaveBeenCalledTimes(2);
    expect(mocks.screenshot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mimeType: 'image/png' }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.pdf.upload', actor: 'owner@example.com' }));
  });

  it('rejects non-PDF MIME types before rendering or storage', async () => {
    const response = await POST(request(new File(['not pdf'], 'image.png', { type: 'image/png' })), params);
    expect(response.status).toBe(415); expect(mocks.renderPdfPages).not.toHaveBeenCalled(); expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rate limits before reading the PDF body', async () => {
    mocks.consume.mockReturnValue({ ok: false, retryAfterSec: 10 });
    const response = await POST(request(new File(['%PDF-1.7'], 'design.pdf', { type: 'application/pdf' })), params);
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('10'); expect(mocks.renderPdfPages).not.toHaveBeenCalled();
  });

  it('removes the source PDF and rendered pages when the database write fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await POST(request(new File(['%PDF-1.7'], 'design.pdf', { type: 'application/pdf' })), params);
    expect(response.status).toBe(500);
    expect(mocks.unlink).toHaveBeenCalledTimes(3);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
