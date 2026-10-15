import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { assertOperator } from '@/lib/teams';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// GET /api/audit?limit=N
//
// The audit log is install-wide (every project, team and workspace), so
// it is restricted to global operators. Team members — including guests
// — must not be able to read other tenants' activity.
//
// `limit`: optional positive integer, clamped to MAX_LIMIT. Missing →
// DEFAULT_LIMIT. Anything that is not a plain positive integer (e.g.
// `abc`, `0`, `-5`, `1.5`) is a 400 rather than `take: NaN` reaching
// Prisma and surfacing as a 500.
export async function GET(req: Request) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  const operator = await assertOperator();
  if (!operator.ok) {
    return NextResponse.json({ error: operator.error }, { status: operator.status });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) {
      return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
    }
    limit = Math.min(Number(limitRaw), MAX_LIMIT);
  }

  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({ entries });
}
