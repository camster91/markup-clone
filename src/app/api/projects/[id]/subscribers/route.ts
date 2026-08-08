import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateSubscriberEmail, validateProjectId } from '@/lib/validation';
import { assertProjectAdmin } from '@/lib/teams';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

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
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAdmin(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { email } = await req.json();

    // Single source of truth for subscriber email shape / length / case
    // normalization. validateSubscriberEmail lowercases the result so
    // 'Alice@Example.com' and 'alice@example.com' are treated as the
    // same subscriber when we look them up by email.
    const emailRes = validateSubscriberEmail(email);
    if (!emailRes.ok) return NextResponse.json({ error: emailRes.error }, { status: 400 });
    const emailNormalized = emailRes.value;

    const subscriber = await prisma.subscriber.create({
      data: { projectId: id, email: emailNormalized },
    });
    audit({
      actor: id,
      action: 'subscriber.add',
      target: id,
      metadata: { email: emailNormalized },
    });
    return NextResponse.json(subscriber, { status: 201 });
  } catch (error) {
    console.error('Subscriber create error:', error);
    return NextResponse.json({ error: 'Failed to add subscriber' }, { status: 500 });
  }
}
