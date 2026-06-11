import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const subscribers = await prisma.subscriber.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(subscribers);
  } catch (error) {
    console.error('Subscribers list error:', error);
    return NextResponse.json({ error: 'Failed to list subscribers' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }

    const subscriber = await prisma.subscriber.create({
      data: { projectId: id, email },
    });
    return NextResponse.json(subscriber, { status: 201 });
  } catch (error) {
    console.error('Subscriber create error:', error);
    return NextResponse.json({ error: 'Failed to add subscriber' }, { status: 500 });
  }
}
