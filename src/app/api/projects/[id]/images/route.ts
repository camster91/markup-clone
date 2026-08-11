import { NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAdmin } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';
import { readImageDimensions } from '@/lib/image-dimensions';
import { audit } from '@/lib/audit';
import { consume } from '@/lib/rate-limit';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

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

  const rate = consume(`project-image-upload:origin:${req.headers.get('origin') ?? 'unknown'}:${projectId.value}`, {
    maxTokens: 10,
    refillRate: 1 / 6,
  });
  if (!rate.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 });
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });

    const extension = EXTENSIONS[file.type];
    if (!extension) return NextResponse.json({ error: `unsupported image type: ${file.type || '(empty)'}` }, { status: 415 });

    const bytes = Buffer.from(await file.arrayBuffer());
    let dimensions;
    try {
      dimensions = readImageDimensions(bytes, file.type);
    } catch {
      return NextResponse.json({ error: 'invalid image data' }, { status: 400 });
    }

    const screenshotId = crypto.randomUUID();
    const storageKey = `${screenshotId}.${extension}`;
    const uploadPath = path.join(/* turbopackIgnore: true */ SCREENSHOTS_DIR, storageKey);
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    await writeFile(uploadPath, bytes);

    try {
      const screenshot = await prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: { projectId: projectId.value, path: `/uploads/${storageKey}` },
          select: { id: true, path: true },
        });
        return tx.screenshot.create({
          data: {
            id: screenshotId,
            pageId: page.id,
            storageKey,
            mimeType: file.type,
            width: dimensions.width,
            height: dimensions.height,
          },
          select: {
            id: true,
            pageId: true,
            storageKey: true,
            mimeType: true,
            width: true,
            height: true,
            capturedAt: true,
          },
        });
      });
      audit({
        actor: access.caller.email,
        action: 'project.image.upload',
        target: screenshot.id,
        metadata: { projectId: projectId.value, pageId: screenshot.pageId, mimeType: screenshot.mimeType, size: file.size },
      });
      return NextResponse.json({
        success: true,
        data: { pageId: screenshot.pageId, screenshot: { ...screenshot, capturedAt: screenshot.capturedAt.toISOString() } },
      }, { status: 201 });
    } catch (error) {
      await unlink(uploadPath).catch((cleanupError: unknown) => console.error('Image upload cleanup error:', cleanupError));
      throw error;
    }
  } catch (error) {
    console.error('Project image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
