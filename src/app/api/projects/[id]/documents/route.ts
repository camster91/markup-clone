import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { consume } from '@/lib/rate-limit';
import { assertPdfHeader } from '@/lib/pdf-renderer';
import { PdfRenderError, renderPdf } from '@/lib/pdf-renderer-runtime';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type must be multipart/form-data' }, { status: 415 });
  }

  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;

  const { id } = await params;
  const projectId = validateProjectId(id);
  if (!projectId.ok) return NextResponse.json({ error: projectId.error }, { status: 400 });
  const access = await assertProjectAdmin(projectId.value);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rate = consume(`project-pdf-upload:origin:${req.headers.get('origin') ?? 'unknown'}:${projectId.value}`, {
    maxTokens: 3,
    refillRate: 1 / 60,
  });
  if (!rate.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } });
  }

  const assetId = crypto.randomUUID();
  const sourceStorageKey = `${crypto.randomUUID()}.pdf`;
  const workDir = path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, `.pdf-${assetId}`);
  const temporarySourcePath = path.join(workDir, 'source.pdf');
  const finalSourcePath = path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, sourceStorageKey);
  const committedPaths: string[] = [];

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'unsupported document type' }, { status: 415 });
    if (file.size === 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 });
    if (file.size > MAX_PDF_UPLOAD_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });

    const bytes = Buffer.from(await file.arrayBuffer());
    try {
      assertPdfHeader(bytes);
    } catch {
      return NextResponse.json({ error: 'invalid PDF data' }, { status: 400 });
    }

    await mkdir(workDir, { recursive: true, mode: 0o700 });
    await writeFile(temporarySourcePath, bytes, { mode: 0o600 });
    const renderedPages = await renderPdf(temporarySourcePath, workDir);
    const pages = renderedPages.map((rendered) => {
      const pageId = crypto.randomUUID();
      const screenshotId = crypto.randomUUID();
      return {
        pageId,
        screenshotId,
        storageKey: `${screenshotId}.png`,
        pageNumber: rendered.pageNumber,
        width: rendered.width,
        height: rendered.height,
        renderedPath: rendered.path,
      };
    });

    await rename(temporarySourcePath, finalSourcePath);
    committedPaths.push(finalSourcePath);
    for (const page of pages) {
      const finalPagePath = path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, page.storageKey);
      await rename(page.renderedPath, finalPagePath);
      committedPaths.push(finalPagePath);
    }

    // Every page from one document shares a creation timestamp so the DTO's
    // secondary assetPageNumber order is deterministic across databases.
    const documentCreatedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.reviewAsset.create({
        data: {
          id: assetId,
          projectId: projectId.value,
          storageKey: sourceStorageKey,
          mimeType: 'application/pdf',
          byteCount: file.size,
          pageCount: pages.length,
        },
      });
      for (const page of pages) {
        await tx.page.create({
          data: {
            id: page.pageId,
            projectId: projectId.value,
            reviewAssetId: assetId,
            assetPageNumber: page.pageNumber,
            path: `/documents/${assetId}/pages/${String(page.pageNumber).padStart(3, '0')}`,
            createdAt: documentCreatedAt,
          },
        });
        await tx.screenshot.create({
          data: {
            id: page.screenshotId,
            pageId: page.pageId,
            storageKey: page.storageKey,
            mimeType: 'image/png',
            width: page.width,
            height: page.height,
          },
        });
      }
    });

    audit({
      actor: access.caller.email,
      action: 'project.pdf.upload',
      target: assetId,
      metadata: {
        projectId: projectId.value,
        pageIds: pages.map((page) => page.pageId),
        mimeType: 'application/pdf',
        byteCount: file.size,
        pageCount: pages.length,
      },
    });
    return NextResponse.json({
      success: true,
      data: { assetId, pageIds: pages.map((page) => page.pageId), pageCount: pages.length },
    }, { status: 201 });
  } catch (error) {
    for (const filePath of committedPaths) {
      await unlink(filePath).catch((cleanupError: unknown) => console.error('PDF upload cleanup error:', cleanupError));
    }
    if (error instanceof PdfRenderError) {
      const status = error.kind === 'too-many-pages' || error.kind === 'output-limit' ? 422
        : error.kind === 'invalid' ? 400
          : error.kind === 'timeout' ? 408
            : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Project PDF upload error:', error);
    return NextResponse.json({ error: 'Failed to upload PDF' }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      console.error('PDF work directory cleanup error:', cleanupError);
    });
  }
}
