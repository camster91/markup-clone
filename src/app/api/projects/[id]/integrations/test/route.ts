// /api/projects/[id]/integrations/test
//
// POST — fire a "test" pin payload at the integration's
// configured webhook. The dispatcher records the outcome on
// the integration row (lastSuccessAt OR lastError +
// lastErrorAt) so the dashboard's "last test" indicator
// reflects the real result of the operator's last click.
//
// Body: { integrationId: string }
//
// Auth: dashboard origin only.
//
// Response shape (always 200, even on adapter failure — the
// dashboard wants to render the error inline, not see a 4xx):
//   { ok: true,  lastSuccessAt: ISO }
//   { ok: false, lastError: string, lastErrorAt: ISO }
//
// We deliberately do NOT return 4xx on an adapter failure.
// The ping itself succeeded (it was a 2xx HTTP roundtrip to
// /api/projects/[id]/integrations/test); the receiver is the
// thing that failed. The dashboard renders the inline error
// from the JSON body, not from the response status.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession } from '@/lib/auth';
import { assertProjectAccessible } from '@/lib/project-access';
import { dispatch } from '@/lib/integrations/dispatcher';
import { isIntegrationKind } from '@/lib/integrations/types';
import { validateConfig } from '@/lib/integrations/validate';
import type { PinPayload } from '@/lib/integrations/types';

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

    const body = (await req.json()) as { integrationId?: unknown };
    if (typeof body.integrationId !== 'string' || body.integrationId.length === 0) {
      return NextResponse.json({ error: 'integrationId required' }, { status: 400 });
    }
    const integrationId = body.integrationId;

    // 1. Find the integration row. The id is part of the URL
    //    projectId's scope (the dashboard sends the right
    //    projectId for the project it's viewing), but we still
    //    filter on BOTH so a copy-paste from a different
    //    project can't fire at an unrelated webhook.
    const row = await prisma.integration.findFirst({
      where: { id: integrationId, projectId },
      include: { project: { select: { id: true, name: true, domain: true } } },
    });
    if (!row) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    // 2. Parse the stored configJson. We treat a parse
    //    failure as a 500 — a malformed configJson would
    //    have slipped past the POST /integrations validator
    //    somehow, and we don't want to silently fire a
    //    half-configured request at the receiver.
    let config: unknown;
    try {
      config = JSON.parse(row.configJson);
    } catch (e) {
      console.error('Integration configJson parse error:', e);
      return NextResponse.json(
        { error: 'Integration config is malformed' },
        { status: 500 }
      );
    }

    // 3. Re-validate. The kind is from the row (not the
    //    request), so we trust the row. validateConfig is
    //    belt-and-suspenders: if a kind was renamed or a
    //    required field was tightened, this catches it
    //    before the dispatcher does.
    if (!isIntegrationKind(row.kind)) {
      return NextResponse.json({ error: 'Integration kind is invalid' }, { status: 500 });
    }
    const cfgRes = validateConfig(row.kind, config);
    if (!cfgRes.ok) {
      return NextResponse.json({ error: cfgRes.error }, { status: 500 });
    }

    // 4. Build a test payload. We use the project's real
    //    name / domain from the row include so the test
    //    message looks like a real one to the receiver. The
    //    pin fields are placeholders — the operator's
    //    webhook should treat this as a sanity check, not
    //    as a real pin.
    const testPayload: PinPayload = {
      pin: {
        id: 'test-pin',
        screenshotId: 'test-screenshot',
        xPercent: 50,
        yPercent: 50,
        status: 'OPEN',
        authorName: 'Test',
        createdAt: new Date().toISOString(),
      },
      project: {
        id: row.project.id,
        name: row.project.name,
        domain: row.project.domain,
      },
      path: '/test',
      commentText: 'This is a test notification from the dashboard.',
    };

    // 5. Dispatch. The dispatcher returns a structured
    //    {ok,error?} result so we don't have to try/catch
    //    a stringified error.
    const result = await dispatch(row.kind, cfgRes.value, testPayload);

    // 6. Persist outcome. We use the prisma update
    //    directly (not a transaction) — the adapter's
    //    outcome is the only thing that matters here, and
    //    a partial write leaves the row in a self-evident
    //    "no lastSuccessAt" state. Same pattern as the
    //    pin route's fire-and-forget notification update.
    const now = new Date();
    if (result.ok) {
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          lastSuccessAt: now,
          // Clear any previous error so the UI shows the
          // green "last success" badge rather than the
          // stale red error.
          lastError: null,
          lastErrorAt: null,
        },
      });
      return NextResponse.json({ ok: true, lastSuccessAt: now.toISOString() });
    }
    await prisma.integration.update({
      where: { id: integrationId },
      data: { lastError: result.error, lastErrorAt: now },
    });
    return NextResponse.json(
      { ok: false, lastError: result.error, lastErrorAt: now.toISOString() },
      { status: 200 }
    );
  } catch (error) {
    console.error('Integration test error:', error);
    return NextResponse.json({ error: 'Failed to test integration' }, { status: 500 });
  }
}
