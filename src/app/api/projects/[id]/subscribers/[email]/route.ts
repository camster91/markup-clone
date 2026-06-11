import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; email: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id: projectId, email } = await params;
    await prisma.subscriber.deleteMany({ where: { projectId, email } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Subscriber delete error:', error);
    return NextResponse.json({ error: 'Failed to remove subscriber' }, { status: 500 });
  }
}
