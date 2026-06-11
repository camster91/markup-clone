import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const { status } = await req.json();
    if (status !== 'OPEN' && status !== 'RESOLVED') {
      return NextResponse.json({ error: 'status must be OPEN or RESOLVED' }, { status: 400 });
    }
    const pin = await prisma.pin.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ success: true, data: pin });
  } catch (error) {
    console.error('Pin update error:', error);
    return NextResponse.json({ error: 'Failed to update pin' }, { status: 500 });
  }
}
