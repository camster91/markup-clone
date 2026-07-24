// /api/projects/[id]/integrations
//
// CRUD for the per-project outbound integration rows. Mirrors
// the conventions of /api/projects/[id]/subscribers:
//
//   GET   — list every integration for a project (dashboard).
//   POST  — create a new integration (dashboard).
//
//   DELETE /api/projects/[id]/integrations/[integrationId] —
//   remove a single integration (dashboard).
//
//   POST /api/projects/[id]/integrations/test — fire a test
//   ping at the integration's webhook and update its
//   lastSuccessAt / lastError. Lives in its own file so the
//   test route's mock surface is separate from the CRUD
//   surface.
//
// All routes are gated by requireDashboardSession — the same
// gate every other /api/projects/* route uses. The widget does
// not (and should not) ever hit these.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { assertProjectAccessible } from '@/lib/project-access';
import { isIntegrationKind, type IntegrationKind } from '@/lib/integrations/types';
import { validateConfig } from '@/lib/integrations/validate';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id: projectId } = await params;
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const integrations = await prisma.integration.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(integrations);
  } catch (error) {
    console.error('Integration list error:', error);
    return NextResponse.json({ error: 'Failed to list integrations' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  try {
    const { id: projectId } = await params;
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = (await req.json()) as { kind?: unknown; config?: unknown };

    // 1. Validate kind against the closed set. We use the same
    //    isIntegrationKind() helper as the dispatcher so the
    //    set is defined exactly once.
    if (!isIntegrationKind(body.kind)) {
      return NextResponse.json(
        { error: 'kind must be one of: slack, discord, webhook' },
        { status: 400 }
      );
    }
    const kind: IntegrationKind = body.kind;

    // 2. Validate the kind-specific config shape.
    const configRes = validateConfig(kind, body.config);
    if (!configRes.ok) {
      return NextResponse.json({ error: configRes.error }, { status: 400 });
    }

    // 3. Project existence + team membership already checked via
    //    assertProjectAccessible above.

    // 4. Insert. We store the config as a JSON string so the
    //    column is a plain TEXT — no Prisma `Json` mapping
    //    quirks. The route hands the same string back on
    //    GET; the dashboard JSON.parses it for the form.
    const integration = await prisma.integration.create({
      data: {
        projectId,
        kind,
        configJson: JSON.stringify(configRes.value),
      },
    });

    // 5. Audit. Same `actor: projectId` convention as
    //    /subscribers — the integration creation is logically
    //    scoped to the project, not to a per-user identity.
    //    No metadata about the secret (the webhook URL is a
    //    credential); record only the kind.
    audit({
      actor: projectId,
      action: 'integration.create',
      target: projectId,
      metadata: { kind },
    });

    return NextResponse.json(integration, { status: 201 });
  } catch (error) {
    console.error('Integration create error:', error);
    return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
  }
}
