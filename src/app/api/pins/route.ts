import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireProjectKey } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { requireDashboardOrigin } from '@/lib/auth';
import { sendSubscriberEmails } from '@/lib/email';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const projectId = form.get('projectId') as string | null;
    const path_ = (form.get('path') as string | null) || '/';
    const xPercent = parseFloat(form.get('xPercent') as string);
    const yPercent = parseFloat(form.get('yPercent') as string);
    const elementXPath = (form.get('elementXPath') as string | null) || null;
    const elementHTML = (form.get('elementHTML') as string | null) || null;
    const screenshot = form.get('screenshot') as File | null;
    const text = (form.get('text') as string | null) || '';
    const authorName = (form.get('authorName') as string | null) || 'Client';

    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    if (!screenshot) return NextResponse.json({ error: 'screenshot required' }, { status: 400 });
    if (Number.isNaN(xPercent) || Number.isNaN(yPercent)) {
      return NextResponse.json({ error: 'xPercent and yPercent required' }, { status: 400 });
    }
    if (screenshot.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: 'screenshot too large' }, { status: 413 });
    }

    // Widget auth: project apiKey via X-Api-Key header
    const authErr = await requireProjectKey(req, projectId);
    if (authErr) return authErr;

    // Ensure project + page exist
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

    const page = await prisma.page.upsert({
      where: { projectId_path: { projectId, path: path_ } },
      update: {},
      create: { projectId, path: path_ },
    });

    // Read screenshot dimensions from PNG header
    const bytes = Buffer.from(await screenshot.arrayBuffer());
    const dimensions = readPngDimensions(bytes);

    // Save screenshot to disk
    const screenshotId = crypto.randomUUID();
    const storageKey = `${screenshotId}.png`;
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    await writeFile(path.join(SCREENSHOTS_DIR, storageKey), bytes);

    // Create screenshot, pin, and first comment in one transaction
    const result = await prisma.$transaction(async (tx) => {
      const ss = await tx.screenshot.create({
        data: {
          id: screenshotId,
          pageId: page.id,
          storageKey,
          width: dimensions.width,
          height: dimensions.height,
        },
      });
      const pin = await tx.pin.create({
        data: {
          screenshotId: ss.id,
          xPercent,
          yPercent,
          elementXPath: elementXPath || undefined,
          elementHTML: elementHTML || undefined,
          authorName,
          comments: text
            ? {
                create: {
                  author: authorName,
                  authorRole: 'client',
                  text,
                },
              }
            : undefined,
        },
        include: { comments: true },
      });
      return { screenshot: ss, pin };
    });

    // Fire-and-forget email notification — query subscribers after tx commits,
    // then send without blocking the response.
    const pid = project.id;
    void prisma.subscriber
      .findMany({ where: { projectId: pid }, select: { email: true } })
      .then((subs) =>
        sendSubscriberEmails({
          projectName: project.name,
          path: path_,
          commentText: text,
          subscriberEmails: subs.map((s) => s.email),
        })
      )
      .catch((err) => console.error('[email] subscriber lookup error:', err));

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('Pin create error:', error);
    return NextResponse.json({ error: 'Failed to create pin' }, { status: 500 });
  }
}

// Read width/height from a PNG buffer (bytes 16-23 of the IHDR chunk)
function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG signature is 8 bytes, IHDR length is 4 bytes, "IHDR" is 4 bytes, then 4 bytes width + 4 bytes height
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    return { width: 0, height: 0 };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}
