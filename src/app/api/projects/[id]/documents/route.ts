import { NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';
import { assertPdfHeader, renderPdfPages } from '@/lib/pdf-renderer';
import { audit } from '@/lib/audit';
import { consume } from '@/lib/rate-limit';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const MAX_PDF_UPLOAD_BYTES = 16 * 1024 * 1024;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) return NextResponse.json({ error: 'Content-Type must be multipart/form-data' }, { status: 415 });
  const authError = await requireDashboardAuth(req); if (authError) return authError;
  const csrfError = requireCsrfToken(req); if (csrfError) return csrfError;
  const { id } = await params;
  const projectId = validateProjectId(id); if (!projectId.ok) return NextResponse.json({ error: projectId.error }, { status: 400 });
  const access = await assertProjectAdmin(projectId.value); if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const rate = consume(`project-pdf-upload:origin:${req.headers.get('origin') ?? 'unknown'}:${projectId.value}`, { maxTokens: 5, refillRate: 1 / 30 });
  if (!rate.ok) return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } });
  try {
    const form = await req.formData(); const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'unsupported document type' }, { status: 415 });
    if (!file.size) return NextResponse.json({ error: 'file is empty' }, { status: 400 });
    if (file.size > MAX_PDF_UPLOAD_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });
    const source = Buffer.from(await file.arrayBuffer());
    try { assertPdfHeader(source); } catch { return NextResponse.json({ error: 'invalid PDF data' }, { status: 400 }); }
    let pages;
    try { pages = await renderPdfPages(source); } catch { return NextResponse.json({ error: 'PDF could not be rendered safely' }, { status: 400 }); }
    const documentId = crypto.randomUUID(); const staged: Array<{ id: string; storageKey: string; bytes: Buffer; width: number; height: number }> = pages.map((page) => ({ id: crypto.randomUUID(), storageKey: `${crypto.randomUUID()}.png`, ...page }));
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    await Promise.all(staged.map((page) => writeFile(path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, page.storageKey), page.bytes)));
    try {
      const created = await prisma.$transaction(async (tx) => Promise.all(staged.map(async (page, index) => {
        const reviewPage = await tx.page.create({ data: { projectId: projectId.value, path: `/documents/${documentId}/page-${index + 1}` }, select: { id: true } });
        return tx.screenshot.create({ data: { id: page.id, pageId: reviewPage.id, storageKey: page.storageKey, mimeType: 'image/png', width: page.width, height: page.height }, select: { id: true, pageId: true, storageKey: true, mimeType: true, width: true, height: true, capturedAt: true } });
      })));
      audit({ actor: access.caller.email, action: 'project.pdf.upload', target: documentId, metadata: { projectId: projectId.value, pageCount: created.length, size: file.size } });
      return NextResponse.json({ success: true, data: { documentId, pages: created.map((page) => ({ ...page, capturedAt: page.capturedAt.toISOString() })) } }, { status: 201 });
    } catch (error) {
      await Promise.all(staged.map((page) => unlink(path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, page.storageKey)).catch(() => undefined)));
      throw error;
    }
  } catch (error) {
    console.error('Project PDF upload error:', error);
    return NextResponse.json({ error: 'Failed to upload PDF' }, { status: 500 });
  }
}
