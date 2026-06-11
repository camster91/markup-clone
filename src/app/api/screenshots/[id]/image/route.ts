import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readFile, stat } from 'fs/promises';
import path from 'path';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ss = await prisma.screenshot.findUnique({ where: { id } });
    if (!ss) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const filePath = path.join(SCREENSHOTS_DIR, ss.storageKey);
    const fileStat = await stat(filePath);
    const buf = await readFile(filePath);

    // ETag for caching
    const etag = `"${ss.id}-${ss.capturedAt.getTime()}"`;

    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304 });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': etag,
      },
    });
  } catch (error) {
    console.error('Screenshot serve error:', error);
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
