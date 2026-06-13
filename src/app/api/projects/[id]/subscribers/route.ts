import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin } from '@/lib/auth';
import { audit } from '@/lib/audit';

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
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }
    // Email addresses are not hostnames but the audit log records them
    // for traceability. Cap the length to something sensible so a
    // malicious operator can't dump 64 KB of garbage into the audit log.
    if (email.length > 320) {
      return NextResponse.json({ error: 'email must be ≤320 chars' }, { status: 400 });
    }
    // Reject anything that looks like a CR/LF (header injection) before it
    // hits the database. RFC 5321 caps email local-part at 64 chars and
    // domain at 255 chars; 320 is the conservative whole-address cap.
    if (/[\r\n]/.test(email)) {
      return NextResponse.json({ error: 'email must not contain control characters' }, { status: 400 });
    }

    const subscriber = await prisma.subscriber.create({
      data: { projectId: id, email },
    });
    audit({
      actor: id,
      action: 'subscriber.add',
      target: id,
      metadata: { email },
    });
    return NextResponse.json(subscriber, { status: 201 });
  } catch (error) {
    console.error('Subscriber create error:', error);
    return NextResponse.json({ error: 'Failed to add subscriber' }, { status: 500 });
  }
}
