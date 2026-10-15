import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { validatePinId } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { assertProjectAccessible } from '@/lib/teams';

// DELETE /api/annotations/[id]
//
// Delete a single annotation by id. Auth: requireDashboardAuth + CSRF.
// The widget has no use case for deleting annotations — once submitted,
// the mark is part of the pin's history and removing it would let a
// client walk back a comment. The dashboard can remove a single
// annotation (e.g. a stray mark the reviewer wants to fix) without
// nuking the whole pin.
//
// Response:
//   200 { success: true }
//   400 invalid id (not a UUID)
//   401 not authenticated / not dashboard origin
//   403 invalid CSRF / caller cannot access the annotation's project
//   404 annotation not found
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      // Same id shape as a Pin id (both are UUIDs), so reuse the
      // helper. The error message is generic enough to cover both
      // cases — the route name in the URL is the disambiguator.
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    // Cheap existence check so we can distinguish "deleted" from
    // "didn't exist" with a 404. Prisma's `delete` would otherwise
    // throw P2025 ("Record to delete does not exist.") which the
    // catch block surfaces as a generic 500.
    //
    // The lookup also resolves annotation -> pin -> screenshot -> page ->
    // project so the delete is tenant-scoped: a session that cannot
    // access the owning project must not be able to remove its marks.
    const existing = await prisma.annotation.findUnique({
      where: { id },
      select: {
        id: true,
        pinId: true,
        pin: { select: { screenshot: { select: { page: { select: { projectId: true } } } } } },
      },
    });
    const projectId = existing?.pin?.screenshot?.page?.projectId;
    if (!existing || !projectId) {
      return NextResponse.json({ error: 'Annotation not found' }, { status: 404 });
    }
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    await prisma.annotation.delete({ where: { id } });
    audit({
      actor: access.caller.email,
      action: 'pin.delete',
      target: existing.pinId,
      metadata: { annotationId: id, projectId },
    });
    return NextResponse.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error('Annotation delete error:', error);
    return NextResponse.json({ error: 'Failed to delete annotation' }, { status: 500 });
  }
}
