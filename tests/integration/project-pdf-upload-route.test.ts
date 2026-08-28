import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reviewAsset: { create: vi.fn() },
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
  rename: vi.fn(),
  rm: vi.fn(),
  unlink: vi.fn(),
  renderPdf: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reviewAsset: mocks.reviewAsset,
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
vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  rename: mocks.rename,
  rm: mocks.rm,
  unlink: mocks.unlink,
}));
vi.mock('@/lib/pdf-renderer-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-renderer-runtime')>();
  return { ...actual, renderPdf: mocks.renderPdf };
});

import { POST } from '@/app/api/projects/[id]/documents/route';
import { PdfRenderError } from '@/lib/pdf-renderer-runtime';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const CSRF_TOKEN = 'test-csrf-token';
const params = { params: Promise.resolve({ id: PROJECT_ID }) };

function request(file: File): Request {
  const form = new FormData();
  form.set('file', file);
  return new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/documents`, {
    method: 'POST',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: form,
  });
}

function pdfFile(bytes: BlobPart = '%PDF-1.7\n'): File {
  return new File([bytes], 'client-proposal.pdf', { type: 'application/pdf' });
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
  mocks.rename.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  mocks.renderPdf.mockResolvedValue([
    { pageNumber: 1, path: '/data/screenshots/.pdf-id/page-1.png', width: 1484, height: 1920, byteCount: 1000 },
    { pageNumber: 2, path: '/data/screenshots/.pdf-id/page-2.png', width: 1484, height: 1920, byteCount: 1100 },
  ]);
  mocks.transaction.mockImplementation(async (callback) => callback({
    reviewAsset: mocks.reviewAsset,
    page: mocks.page,
    screenshot: mocks.screenshot,
  }));
  mocks.reviewAsset.create.mockResolvedValue({ id: 'asset-id' });
  mocks.page.create.mockResolvedValue({ id: 'page-id' });
  mocks.screenshot.create.mockResolvedValue({ id: 'screenshot-id' });
});

describe('POST /api/projects/[id]/documents', () => {
  it('stores an opaque PDF source and normal review pages in natural order', async () => {
    const response = await POST(request(pdfFile()), params);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, data: { pageCount: 2 } });
    expect(mocks.reviewAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: PROJECT_ID, mimeType: 'application/pdf', pageCount: 2 }),
    });
    expect(mocks.reviewAsset.create.mock.calls[0][0].data).not.toHaveProperty('filename');
    expect(mocks.page.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ reviewAssetId: expect.any(String), assetPageNumber: 1 }),
    });
    expect(mocks.page.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ reviewAssetId: expect.any(String), assetPageNumber: 2 }),
    });
    expect(mocks.screenshot.create).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'owner@example.com',
      action: 'project.pdf.upload',
      metadata: expect.not.objectContaining({ filename: expect.anything() }),
    }));
  });

  it('rejects MIME-spoofed and unsupported files before writing bytes', async () => {
    const spoofed = await POST(request(pdfFile('<svg/>')), params);
    expect(spoofed.status).toBe(400);
    const form = new FormData();
    form.set('file', new File(['%PDF-1.7'], 'unsafe.svg', { type: 'image/svg+xml' }));
    const unsupportedRequest = new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}/documents`, {
      method: 'POST',
      headers: { origin: 'https://markup.ashbi.ca', 'X-CSRF-Token': CSRF_TOKEN, cookie: `markup.csrf=${CSRF_TOKEN}` },
      body: form,
    });
    const unsupported = await POST(unsupportedRequest, params);
    expect(unsupported.status).toBe(415);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rejects sources larger than 20 MB', async () => {
    const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    bytes.set(new TextEncoder().encode('%PDF-'));
    const response = await POST(request(pdfFile(bytes)), params);
    expect(response.status).toBe(413);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rejects non-administrators before reading or rendering the multipart body', async () => {
    mocks.assertProjectAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Owner or operator role required' });
    const response = await POST(request(pdfFile()), params);
    expect(response.status).toBe(403);
    expect(mocks.renderPdf).not.toHaveBeenCalled();
  });

  it('returns the CSRF failure before project access or rendering', async () => {
    mocks.requireCsrfToken.mockReturnValue(new Response(null, { status: 403 }));
    const response = await POST(request(pdfFile()), params);
    expect(response.status).toBe(403);
    expect(mocks.assertProjectAdmin).not.toHaveBeenCalled();
    expect(mocks.renderPdf).not.toHaveBeenCalled();
  });

  it('rate limits before reading or rendering the multipart body', async () => {
    mocks.consume.mockReturnValue({ ok: false, retryAfterSec: 60 });
    const response = await POST(request(pdfFile()), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(mocks.renderPdf).not.toHaveBeenCalled();
  });

  it('maps page-count and timeout failures and always removes the private work directory', async () => {
    mocks.renderPdf.mockRejectedValueOnce(new PdfRenderError('PDF has more than 50 pages', 'too-many-pages'));
    const tooMany = await POST(request(pdfFile()), params);
    expect(tooMany.status).toBe(422);

    mocks.renderPdf.mockRejectedValueOnce(new PdfRenderError('PDF rendering timed out', 'timeout'));
    const timeout = await POST(request(pdfFile()), params);
    expect(timeout.status).toBe(408);
    expect(mocks.rm).toHaveBeenCalledTimes(2);
  });

  it('removes every committed source/page file if persistence fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await POST(request(pdfFile()), params);
    expect(response.status).toBe(500);
    expect(mocks.unlink).toHaveBeenCalledTimes(3);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });
});
