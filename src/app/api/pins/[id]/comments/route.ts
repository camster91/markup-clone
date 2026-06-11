import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const { text, author, authorRole } = await req.json();
    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const comment = await prisma.comment.create({
      data: {
        pinId: id,
        text,
        author: author || 'Reviewer',
        authorRole: authorRole || 'reviewer',
      },
    });
    return NextResponse.json({ success: true, data: comment }, { status: 201 });
  } catch (error) {
    console.error('Comment create error:', error);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}
