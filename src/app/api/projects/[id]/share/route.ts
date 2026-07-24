// /api/projects/[id]/share
//
// Generate or revoke the public read-only share link for a project.
//
//   POST   /api/projects/[id]/share  — generate a new shareToken (rotates any
//                                      existing token). Returns { shareToken,
//                                      shareUrl } so the dashboard can show
//                                      the URL to the user immediately.
//   DELETE /api/projects/[id]/share  — revoke the current shareToken by
//                                      setting it back to null. Idempotent:
//                                      deleting when no token is set returns
//                                      200 with { revoked: false }.
//
// Both routes require a dashboard-origin request (the same gate the rest of
// /api/projects/* uses) so the only way to mint or revoke a token is from
// inside the dashboard. The public view at /share/[token] does NOT go
// through this gate — see src/app/share/[token]/page.tsx for the no-auth
// read-only rendering.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth, generateShareToken } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateProjectId } from '@/lib/validation';
import { assertProjectAccessible } from '@/lib/teams';

// Generate a new share token for the project.
//
// A POST is always a "rotate" — even if a token already exists, this
// issues a fresh one and overwrites the old. That's the intended behavior:
// the dashboard's "Generate share link" button is the only mint surface,
// and clicking it again should invalidate the previous link so a leaked
// URL can be cut off with a single click. We surface the new token in
// the response so the UI can show "copy this URL" without a second
// round-trip.
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

    const access = await assertProjectAccessible(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Verify the project exists first. Without this, prisma.update
    // throws P2025 (not found) which the catch turns into 500 — the
    // user can't distinguish "project not found" from "the database
    // exploded". Same pattern as /api/projects/[id] PATCH/DELETE.
    // (assertProjectAccessible already 404s on missing; re-read for name.)
    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const shareToken = generateShareToken();
    const project = await prisma.project.update({
      where: { id },
      data: { shareToken },
      select: { id: true, name: true, shareToken: true },
    });

    // Do not log the plaintext shareToken in the audit metadata. The
    // token IS the credential — anyone with /api/audit dashboard access
    // (and a future log-search UI) should not be able to read the URL
    // and impersonate a public viewer. Record a "was created" marker
    // instead, same pattern as PATCH /api/projects/[id] for apiKey.
    audit({
      actor: id,
      action: 'project.share.create',
      target: id,
      metadata: { name: existing.name, shareToken: 'created' },
    });

    return NextResponse.json({
      shareToken: project.shareToken,
      // The shareUrl is built from the request's host so the value
      // matches whatever the dashboard user is currently on (localhost
      // in dev, the production hostname in prod). The dashboard's
      // ShareToggle component just displays this as a copyable link.
      shareUrl: new URL(`/share/${project.shareToken}`, req.url).toString(),
    });
  } catch (error) {
    // P2002 is the unique-constraint race when a collision slips
    // through (vanishingly unlikely with 256-bit tokens, but a real
    // failure mode for a 503 DB). Surface it as 500; the operator can
    // retry. We deliberately do NOT retry internally — that would
    // multiply audit-log rows.
    console.error('Share create error:', error);
    return NextResponse.json({ error: 'Failed to create share token' }, { status: 500 });
  }
}

// Revoke the share token. Idempotent: calling DELETE when the project
// has no token is a 200 with { revoked: false } so the dashboard's
// "Revoke" button can stay enabled after a previous revoke without a
// pre-flight check.
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
    const idRes = validateProjectId(id);
    if (!idRes.ok) return NextResponse.json({ error: idRes.error }, { status: 400 });

    const access = await assertProjectAccessible(id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // findUnique so we can distinguish "project not found" (404) from
    // "project exists but no token" (200, revoked: false). The PATCH
    // route uses the same pattern.
    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true, shareToken: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (existing.shareToken === null) {
      // Nothing to do — return idempotent success.
      return NextResponse.json({ revoked: false });
    }

    await prisma.project.update({
      where: { id },
      data: { shareToken: null },
    });

    audit({
      actor: id,
      action: 'project.share.revoke',
      target: id,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error('Share revoke error:', error);
    return NextResponse.json({ error: 'Failed to revoke share token' }, { status: 500 });
  }
}
