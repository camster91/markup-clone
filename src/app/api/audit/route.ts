import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 500);

  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({ entries });
}
