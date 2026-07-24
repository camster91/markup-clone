import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { validatePinId } from '@/lib/validation';
import { audit } from '@/lib/audit';

// DELETE /api/annotations/[id]
//
// Delete a single annotation by id. Auth: dashboard-origin only
// (`requireDashboardSession`). The widget has no use case for deleting
// annotations — once submitted, the mark is part of the pin's history
// and removing it would let a client walk back a comment. The
// dashboard can remove a single annotation (e.g. a stray mark the
// reviewer wants to fix) without nuking the whole pin.
//
// Response:
//   200 { success: true }
//   400 invalid id (not a UUID)
//   401 not a dashboard request
//   404 annotation not found
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      // Same id shape as a Pin id (both are UUIDs), so reuse the
      // helper. The error message is generic enough to cover both
      // cases — the route name in the URL is the disambiguator.
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    const origin = req.headers.get('origin') ?? 'unknown';
    const rateCheck = consume(`annotations:origin:${origin}:${idRes.value}`, { maxTokens: 30, refillRate: 0.5 });
    if (!rateCheck.ok) {
      return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
    }

    // Cheap existence check so we can distinguish "deleted" from
    // "didn't exist" with a 404. Prisma's `delete` would otherwise
    // throw P2025 ("Record to delete does not exist.") which the
    // catch block surfaces as a generic 500.
    const existing = await prisma.annotation.findUnique({ where: { id }, select: { id: true, pinId: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Annotation not found' }, { status: 404 });
    }

    await prisma.annotation.delete({ where: { id } });
    audit({ actor: 'dashboard', action: 'pin.delete', target: existing.pinId, metadata: { annotationId: id } });
    return NextResponse.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error('Annotation delete error:', error);
    return NextResponse.json({ error: 'Failed to delete annotation' }, { status: 500 });
  }
}
