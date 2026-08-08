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
// Auth: requireDashboardAuth (Origin + session). POST also requires
// CSRF. apiKey/shareToken stay in the GET response — the session
// gate is what makes emitting them safe.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth, generateApiKey } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { validateProjectDomain, validateProjectName, validateUuidParam } from '@/lib/validation';
import {
  assertProjectCreateAdmin,
  canAdminProject,
  getCallerAdminTeamIds,
  getCallerUser,
  getProjectScopeWhere,
} from '@/lib/teams';
import { loadProjectSummaryCounts, projectSummaryCountsOrZero } from '@/lib/project-summary-counts';

export async function GET(req: Request) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;

  try {
    const state = new URL(req.url).searchParams.get('state') ?? 'active';
    if (state !== 'active' && state !== 'archived' && state !== 'all') {
      return NextResponse.json({ error: 'state must be active, archived, or all' }, { status: 400 });
    }
    // Resolve the caller and their team scope. The where clause is
    // composed BEFORE the `updatedAt` filter so the two filters AND
    // together: callers see "projects in my teams" AND "updated since
    // the cursor" — never one without the other. The pre-existing
    // tests that mock prisma.project.findMany without our teams helper
    // will see the new `where` shape; the integration tests updated
    // alongside this change assert the team-scope filter is applied.
    const caller = await getCallerUser();
    if (!caller) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 403 });
    }
    const teamScope = await getProjectScopeWhere(caller);
    const where = state === 'all'
      ? teamScope
      : { AND: [teamScope, state === 'active' ? { archivedAt: null } : { archivedAt: { not: null } }] };
    const adminTeamIds = caller.role === 'operator' ? [] : await getCallerAdminTeamIds(caller.id);

    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        domain: true,
        apiKey: true,
        shareToken: true,
        shareExpiresAt: true,
        sharePasswordHash: true,
        teamId: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        // The team relation is included so the dashboard's
        // ProjectListCard can render "in <team name>" without a
        // follow-up lookup. `select` is limited to the columns the
        // dashboard actually needs (id + name); the rest is a
        // network-cost-no-no on a list endpoint.
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const summaryCounts = await loadProjectSummaryCounts(projects.map((project) => project.id));
    // Project has no `include`-able shareToken — it's a top-level
    // scalar. select it explicitly so the dashboard's ShareToggle can
    // see whether a token is active. `shareToken` is dashboard-only
    // (session-gated) so emitting the raw token here is fine — only
    // an authenticated dashboard user can hit this endpoint, and they
    // need the token to render the share URL.
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
      projects.map((p) => {
        const canAdmin = canAdminProject(caller, p.teamId, adminTeamIds);
        const counts = projectSummaryCountsOrZero(summaryCounts, p.id);
        return {
        id: p.id,
        name: p.name,
        domain: p.domain,
        apiKey: canAdmin ? p.apiKey : null,
        shareToken: canAdmin ? p.shareToken : null,
        shareExpiresAt: canAdmin ? p.shareExpiresAt?.toISOString() ?? null : null,
        sharePasswordProtected: canAdmin ? Boolean(p.sharePasswordHash) : false,
        canAdmin,
        teamId: p.teamId,
        archivedAt: p.archivedAt,
        team: p.team,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        ...counts,
      }})
    );
  } catch (error) {
    console.error('Projects list error:', error);
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

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

    // Owners may create projects inside their team; global operators may
    // create either team-scoped or legacy unscoped projects.
    let teamIdValue: string | null = null;
    if (teamId !== undefined && teamId !== null) {
      const tidRes = validateUuidParam(teamId, 'teamId');
      if (!tidRes.ok) return NextResponse.json({ error: tidRes.error }, { status: 400 });
      teamIdValue = tidRes.value;
    }

    const admin = await assertProjectCreateAdmin(teamIdValue);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
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
