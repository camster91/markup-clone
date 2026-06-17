import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardOrigin, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { validateProjectDomain, validateProjectName } from '@/lib/validation';

export async function GET(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  // Optional ?since=<ISO> delta polling. When set, only rows whose
  // updatedAt (or capturedAt, for Screenshot) is strictly after `since`
  // are returned at every nested level — Project, Page, Screenshot, Pin,
  // Comment. The dashboard passes `lastSuccessfulPoll - 1000` as `since`
  // so two rows updated in the same millisecond (e.g. two pins created
  // by the same request) cannot race past the cursor. When `since` is
  // missing or unparseable, the route falls back to the legacy
  // "return the full tree" behaviour.
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : null;
  const filterSince = sinceParam && !Number.isNaN(since!.getTime());

  const projects = await prisma.project.findMany({
    where: filterSince ? { updatedAt: { gt: since! } } : undefined,
    include: {
      pages: {
        where: filterSince ? { updatedAt: { gt: since! } } : undefined,
        include: {
          screenshots: {
            // Screenshot has no `updatedAt` field — its lifetime marker
            // is `capturedAt`. Same semantics: only screenshots captured
            // after the cursor are part of the delta.
            where: filterSince ? { capturedAt: { gt: since! } } : undefined,
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: {
                where: filterSince ? { updatedAt: { gt: since! } } : undefined,
                orderBy: { createdAt: 'asc' },
                include: {
                  comments: {
                    where: filterSince ? { updatedAt: { gt: since! } } : undefined,
                    orderBy: { createdAt: 'asc' },
                  },
                  // Annotations: drawn arrows / boxes / freehand
                  // attached to each pin. The ScreenshotView's SVG
                  // overlay reads these and renders one <line>/<rect>/
                  // <polyline> per row. The `where` filters on
                  // createdAt — no Annotation has an `updatedAt` so
                  // a new annotation always reflects a new pin event
                  // for delta polling. We parse pathJson into a
                  // `number[][]` shape on the way out (the server
                  // stores it as a JSON string for schema flexibility).
                  annotations: {
                    ...(filterSince ? { where: { createdAt: { gt: since! } } } : {}),
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
      subscribers: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  // Project has no `include`-able shareToken — it's a top-level
  // scalar. select it explicitly so the dashboard's ShareToggle can
  // see whether a token is active. `shareToken` is dashboard-only
  // (the route is gated by requireDashboardOrigin) so emitting the
  // raw token here is fine — only a dashboard user can hit this
  // endpoint, and they need the token to render the share URL.
  //
  // Annotation rows include `pathJson` as a JSON string (the DB
  // column shape). We parse it client-side at fetch time so the
  // dashboard sees `path: number[][]` directly — saves every render
  // from re-parsing, and lines up with the FeedbackAnnotation type
  // (which declares `path` as a parsed array, not a string).
  //
  // A malformed pathJson would have been rejected at write time by
  // the POST /api/annotations validator, so the JSON.parse here
  // only fails on a hand-crafted DB row. We fall back to an empty
  // array so the pin's overlay renders without an exception, and
  // log once at the route level so a corruption is auditable.
  //
  // `pin.annotations` may be undefined in tests that mock the
  // prisma include with the legacy shape (no annotation field).
  // Coerce to [] so the response shape is always the same.
  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      apiKey: p.apiKey,
      shareToken: p.shareToken,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      pages: p.pages.map((page) => ({
        ...page,
        screenshots: page.screenshots.map((screenshot) => ({
          ...screenshot,
          pins: screenshot.pins.map((pin) => ({
            ...pin,
            annotations: (pin.annotations ?? []).map((a) => {
              let path: number[][] = [];
              try {
                const parsed = JSON.parse(a.pathJson);
                if (Array.isArray(parsed)) path = parsed as number[][];
              } catch (err) {
                // Don't leak the per-request loop noise — log once.
                // Production data should never reach this branch
                // (the POST /api/annotations validator rejects
                // malformed input).
                console.warn(`[projects] annotation ${a.id} has unparseable pathJson`);
              }
              return {
                id: a.id,
                kind: a.kind,
                path,
                createdAt: a.createdAt,
              };
            }),
          })),
        })),
      })),
      subscribers: p.subscribers,
    }))
  );
}

export async function POST(req: Request) {
  const authErr = requireDashboardOrigin(req);
  if (authErr) return authErr;

  try {
    const { name, domain } = await req.json();
    if (!name || !domain) {
      return NextResponse.json({ error: 'name and domain required' }, { status: 400 });
    }

    // Validate name + domain BEFORE the DB write. validateProjectDomain
    // rejects local/loopback hostnames and IP addresses so a project can't
    // be registered that would later turn the recapture flow into an SSRF
    // vector (recapture.sh builds a URL of `https://<domain><path>` and
    // shells out to Chromium). The validator was previously implemented in
    // src/lib/validation.ts but never wired up here.
    const nameRes = validateProjectName(name);
    if (!nameRes.ok) return NextResponse.json({ error: nameRes.error }, { status: 400 });
    const domainRes = validateProjectDomain(domain);
    if (!domainRes.ok) return NextResponse.json({ error: domainRes.error }, { status: 400 });

    const apiKey = generateApiKey();
    const project = await prisma.project.create({
      data: { name, domain, apiKey },
    });
    audit({ actor: project.id, action: 'project.create', target: project.id });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Project create error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
