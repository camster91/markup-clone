// /api/workspaces/[id]/teams/[teamId]/members/[memberId]
//
// Per-member operations: change role (PATCH) and remove (DELETE).
// Adding a new member is on the parent route; this file owns the
// lifecycle of a single existing row.
//
// The triple-UUID URL pattern (workspace / team / member) is verbose
// but the alternatives all leak the wrong info: a `/members/[id]`
// route would either let a caller guess member ids across teams, or
// force an extra server-side lookup to scope. The nested form makes
// the scope explicit at the route signature level.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { validateTeamRole, validateUuidParam } from '@/lib/validation';

async function findMember(workspaceId: string, teamId: string, memberId: string) {
  return prisma.teamMember.findFirst({
    where: {
      id: memberId,
      teamId,
      team: { workspaceId },
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string; memberId: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id, teamId, memberId } = await params;
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
    const midRes = validateUuidParam(memberId, 'memberId');
    if (!midRes.ok) return NextResponse.json({ error: midRes.error }, { status: 400 });

    const origin = req.headers.get('origin') ?? 'unknown';
    const rateCheck = consume(`members:origin:${origin}:${midRes.value}`, { maxTokens: 30, refillRate: 0.5 });
    if (!rateCheck.ok) {
      return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
    }

    const body = await req.json();
    const { role } = body as { role?: unknown };
    const roleRes = validateTeamRole(role);
    if (!roleRes.ok) return NextResponse.json({ error: roleRes.error }, { status: 400 });

    const existing = await findMember(widRes.value, tidRes.value, midRes.value);
    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    const member = await prisma.teamMember.update({
      where: { id: midRes.value },
      data: { role: roleRes.value },
    });
    audit({
      actor: member.id,
      action: 'team_member.update',
      target: member.id,
      metadata: { teamId: tidRes.value, role: member.role },
    });
    return NextResponse.json(member);
  } catch (error) {
    console.error('TeamMember update error:', error);
    return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string; memberId: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id, teamId, memberId } = await params;
    const widRes = validateUuidParam(id, 'id');
    if (!widRes.ok) return NextResponse.json({ error: widRes.error }, { status: 400 });
    const tidRes = validateUuidParam(teamId, 'teamId');
    if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
    const midRes = validateUuidParam(memberId, 'memberId');
    if (!midRes.ok) return NextResponse.json({ error: midRes.error }, { status: 400 });

    const origin = req.headers.get('origin') ?? 'unknown';
    const rateCheck = consume(`members:origin:${origin}:${midRes.value}`, { maxTokens: 30, refillRate: 0.5 });
    if (!rateCheck.ok) {
      return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
    }

    const existing = await findMember(widRes.value, tidRes.value, midRes.value);
    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    await prisma.teamMember.delete({ where: { id: midRes.value } });
    audit({
      actor: midRes.value,
      action: 'team_member.remove',
      target: midRes.value,
      metadata: { teamId: tidRes.value, email: existing.email, role: existing.role },
    });
    return NextResponse.json({ deleted: true, id: midRes.value });
  } catch (error) {
    console.error('TeamMember delete error:', error);
    return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
  }
}
