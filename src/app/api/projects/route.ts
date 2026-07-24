// /api/projects
//
// Project list + create. The team layer is ADDITIVE — the GET filter
// is "projects whose team is one the caller is a member of", and a
// NULL teamId is treated as "legacy / unscoped" and shown only to
// callers with zero team memberships (the transitional single-project
// dashboard behaviour — see lib/teams.ts for the rationale).
//
// POST: the body now accepts an optional `teamId`. When supplied, the
// project is created under that team. The validation step verifies
// the team exists AND the caller is a member of it; without that
// check, a dashboard caller could attach a project to any team in
// the install. When teamId is omitted, the project is created with
// teamId = NULL (legacy behaviour, kept for back-compat with the
// single-team install).
//
// Auth: every handler is gated by requireDashboardSession (Origin
// CSRF + active session cookie). The team-scope filter is a "which
// projects does this caller see" gate on top of that.
//
// GET query params:
//   ?view=summary — light tree: pins as { id, status } only (no
//     comments / annotations). Used by the home poller + SSR.
//   ?view=full or omitted — full tree (comments + annotations).
//   ?id=<uuid> — restrict to a single project (0..1 rows). Used by
//     ProjectDetail so it doesn't download every project.
//   ?since=<ISO> — delta filter at every nested level (unchanged).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardSession, generateApiKey } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { consume } from '@/lib/rate-limit';
import { validateProjectDomain, validateProjectName, validateUuidParam } from '@/lib/validation';
import { getCallerUser, getProjectScopeWhere } from '@/lib/teams';

export async function GET(req: Request) {
  const authErr = await requireDashboardSession(req);
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
  const filterSince = !!(sinceParam && since && !Number.isNaN(since.getTime()));

  // ?view=summary → pins as { id, status } only (home list / poller).
  // Absent or `full` → comments + annotations included (detail consumers).
  const viewParam = url.searchParams.get('view');
  const isSummary = viewParam === 'summary';

  // Optional ?id=<uuid> → single-project filter (array of length 0..1).
  // ProjectDetail polls with this so it never downloads the full list.
  const idParam = url.searchParams.get('id');
  let projectIdFilter: string | undefined;
  if (idParam) {
    const idRes = validateUuidParam(idParam, 'id');
    if (!idRes.ok) {
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }
    projectIdFilter = idRes.value;
  }

  // Resolve the caller and their team scope. The where clause is
  // composed BEFORE the `updatedAt` filter so the two filters AND
  // together: callers see "projects in my teams" AND "updated since
  // the cursor" — never one without the other.
  const caller = await getCallerUser();
  const teamScope = await getProjectScopeWhere(caller?.id ?? null);

  // Pin include shape depends on view. Summary skips comments /
  // annotations (and uses select so Prisma doesn't pull the columns).
  const pinsQuery = isSummary
    ? {
        where: filterSince ? { updatedAt: { gt: since! } } : undefined,
        orderBy: { createdAt: 'asc' as const },
        select: { id: true, status: true },
      }
    : {
        where: filterSince ? { updatedAt: { gt: since! } } : undefined,
        orderBy: { createdAt: 'asc' as const },
        include: {
          comments: {
            where: filterSince ? { updatedAt: { gt: since! } } : undefined,
            orderBy: { createdAt: 'asc' as const },
          },
          annotations: {
            ...(filterSince ? { where: { createdAt: { gt: since! } } } : {}),
            orderBy: { createdAt: 'asc' as const },
          },
        },
      };

  const projects = await prisma.project.findMany({
    where: {
      AND: [
        teamScope,
        ...(projectIdFilter ? [{ id: projectIdFilter }] : []),
        ...(filterSince ? [{ updatedAt: { gt: since! } }] : []),
      ],
    },
    include: {
      pages: {
        where: filterSince ? { updatedAt: { gt: since! } } : undefined,
        include: {
          screenshots: {
            where: filterSince ? { capturedAt: { gt: since! } } : undefined,
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: pinsQuery,
            },
          },
        },
      },
      subscribers: true,
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (isSummary) {
    return NextResponse.json(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        domain: p.domain,
        apiKey: p.apiKey,
        shareToken: p.shareToken,
        teamId: p.teamId,
        team: p.team,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        pages: p.pages.map((page) => ({
          id: page.id,
          path: page.path,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          screenshots: page.screenshots.map((screenshot) => ({
            id: screenshot.id,
            storageKey: screenshot.storageKey,
            pageId: screenshot.pageId,
            width: screenshot.width,
            height: screenshot.height,
            capturedAt: screenshot.capturedAt,
            pins: screenshot.pins.map((pin) => ({
              id: pin.id,
              status: pin.status,
            })),
          })),
        })),
        subscribers: p.subscribers,
      }))
    );
  }

  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      apiKey: p.apiKey,
      shareToken: p.shareToken,
      teamId: p.teamId,
      team: p.team,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      pages: p.pages.map((page) => ({
        ...page,
        screenshots: page.screenshots.map((screenshot) => ({
          ...screenshot,
          pins: screenshot.pins.map((pin) => {
            const fullPin = pin as typeof pin & {
              xPercent: number;
              yPercent: number;
              elementXPath: string | null;
              authorName: string | null;
              createdAt: Date;
              updatedAt: Date;
              screenshotId: string;
              comments: unknown;
              annotations?: Array<{
                id: string;
                kind: string;
                pathJson: string;
                createdAt: Date;
              }>;
            };
            return {
              id: fullPin.id,
              xPercent: fullPin.xPercent,
              yPercent: fullPin.yPercent,
              status: fullPin.status,
              elementXPath: fullPin.elementXPath,
              authorName: fullPin.authorName,
              createdAt: fullPin.createdAt,
              updatedAt: fullPin.updatedAt,
              screenshotId: fullPin.screenshotId,
              comments: fullPin.comments,
              annotations: (fullPin.annotations ?? []).map((a) => {
                let path: number[][] = [];
                try {
                  const parsed = JSON.parse(a.pathJson);
                  if (Array.isArray(parsed)) path = parsed as number[][];
                } catch {
                  console.warn(`[projects] annotation ${a.id} has unparseable pathJson`);
                }
                return {
                  id: a.id,
                  kind: a.kind,
                  path,
                  createdAt: a.createdAt,
                };
              }),
            };
          }),
        })),
      })),
      subscribers: p.subscribers,
    }))
  );
}

export async function POST(req: Request) {
  const authErr = await requireDashboardSession(req);
  if (authErr) return authErr;

  const origin = req.headers.get('origin') ?? 'unknown';
  const rateCheck = consume(`projects:origin:${origin}:new`, { maxTokens: 30, refillRate: 0.5 });
  if (!rateCheck.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } });
  }

  try {
    const { name, domain, teamId } = await req.json();
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

    // Optional teamId: when supplied, verify it's a UUID and the
    // caller is a member of the team. A non-member creating a
    // project under a team they don't belong to is the
    // "attach a project to someone else's team" footgun — the
    // membership check is the gate. When teamId is omitted, the
    // project is created with teamId = NULL (legacy / unscoped).
    let teamIdValue: string | null = null;
    if (teamId !== undefined && teamId !== null) {
      const tidRes = validateUuidParam(teamId, 'teamId');
      if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
      const caller = await getCallerUser();
      const callerTeamIds = caller
        ? (
            await prisma.teamMember.findMany({
              where: { userId: caller.id, teamId: tidRes.value },
              select: { teamId: true },
            })
          ).map((r) => r.teamId)
        : [];
      if (!callerTeamIds.includes(tidRes.value)) {
        return NextResponse.json(
          { error: 'You are not a member of the requested team' },
          { status: 403 }
        );
      }
      teamIdValue = tidRes.value;
    }

    const apiKey = generateApiKey();
    const project = await prisma.project.create({
      data: { name, domain, apiKey, teamId: teamIdValue },
    });
    audit({
      actor: project.id,
      action: 'project.create',
      target: project.id,
      metadata: { teamId: teamIdValue },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Project create error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
