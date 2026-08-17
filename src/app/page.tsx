import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
import DashboardPoller from '@/components/DashboardPoller';
import AuthGate from '@/components/AuthGate';
import PublicLanding from '@/components/PublicLanding';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import type { ProjectSummary } from '@/lib/types';
import {
  canAdminProject,
  getCallerAdminTeamIds,
  getCallerUser,
  getProjectScopeWhere,
} from '@/lib/teams';
import { parseHost } from '@/lib/origin';
import { loadProjectSummaryCounts, projectSummaryCountsOrZero } from '@/lib/project-summary-counts';
import { returnDestinationLabel, safeReturnPath } from '@/lib/sign-in-redirect';

// / (dashboard home)
//
// React Server Component. The home page is a thin server-rendered
// shell that:
//   1. Fetches the same compact project-summary shape returned by
//      /api/projects so first paint and later refreshes share a
//      bounded contract.
//   2. Renders <NewProjectForm> (a client component) for the
//      create flow.
//   3. Renders <AuthGate> (a client component) for the session
//      modal — this is the canonical auth gate for the
//      dashboard origin.
//   4. Renders <DashboardPoller projects={initialData}>, the
//      client island that owns the 5s polling loop and renders
//      <DashboardProjects> with the latest data.
//
// Why an RSC: the first paint carries compact project summaries in
// the HTML so the operator sees their projects immediately — no
// loading flash and no JS-required state hydration.
// The client island <DashboardPoller> takes over from there:
// it owns the live state and the 5s poll. The summary includes
// aggregate page, capture, pin, and open-pin counts; full comments,
// annotations, screenshot context, and subscribers stay confined to
// the per-project detail route.
//
// Team-scope: the same helper that gates /api/projects'
// team-scope filter (getProjectScopeWhere) gates this RSC's
// fetch. A caller with team memberships sees their teams'
// projects; a caller with no memberships sees the legacy /
// unscoped (teamId IS NULL) projects; operators see every project.
// Anonymous callers receive only the sign-in shell and no project
// query or secret-bearing server payload.
//
// Widget snippet: the page still renders the snippet for
// the latest project (by createdAt desc). The snippet is
// the `<script src=".../widget.js" data-api-key="..." />`
// block the operator pastes into the client site. We
// derive the latest project's apiKey + id from the summary
// list (the first row of the sorted findMany is the latest
// project) — no second DB query needed.
//
// force-dynamic: a new project / a new pin should appear on
// the next page load, not after a cache TTL. The RSC fetches
// on every request; the 5s polling island refreshes the compact
// list after the first paint.

export const dynamic = 'force-dynamic';

type DashboardProps = {
  searchParams?: Promise<{ next?: string | string[] }>;
};

export default async function Dashboard({ searchParams }: DashboardProps = {}) {
  // Server-side fetch. Same compact shape as /api/projects so the
  // client island can replace it atomically on every successful poll.
  //
  // Team-scope filter: reviewers see projects whose team is one
  // they belong to; operators see all projects. Mirrors the /api/projects
  // route's where clause so the first paint matches what the
  // polling client will see on its first refresh.
  const caller = await getCallerUser();
  if (!caller) {
    const query = searchParams ? await searchParams : {};
    const returnTo = safeReturnPath(query.next);
    return PublicLanding({
      returnTo,
      destinationLabel: returnDestinationLabel(returnTo),
    });
  }

  const teamScope = await getProjectScopeWhere(caller);
  const activeScope = { AND: [teamScope, { archivedAt: null }] };
  const adminTeamIds = caller.role === 'operator' ? [] : await getCallerAdminTeamIds(caller.id);

  const projects = await prisma.project.findMany({
    where: activeScope,
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
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const summaryCounts = await loadProjectSummaryCounts(projects.map((project) => project.id));

  // Serialize the tree to the ProjectWithPages shape. Same
  // contract as the /api/projects route: Date fields are
  // ISO strings, annotation.pathJson is parsed into a
  // number[][] `path` field, missing annotations default to
  // an empty array. The client FeedbackAnnotation type
  // declares `path` as a parsed array — the page is the
  // conversion boundary.
  //
  // Secrets (apiKey / shareToken): only included when the
  // caller has an authenticated session. Anonymous HTML must
  // not embed project keys — the AuthGate login modal is the
  // gate; once logged in, a full navigation re-renders with
  // secrets present for WidgetSnippet / ShareToggle.
  const initialData: ProjectSummary[] = projects.map((p) => {
    const canAdmin = canAdminProject(caller, p.teamId, adminTeamIds);
    const counts = projectSummaryCountsOrZero(summaryCounts, p.id);
    return {
    id: p.id,
    name: p.name,
    domain: p.domain,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    apiKey: canAdmin ? p.apiKey : null,
    shareToken: canAdmin ? p.shareToken : null,
    shareExpiresAt: canAdmin ? p.shareExpiresAt?.toISOString() ?? null : null,
    sharePasswordProtected: canAdmin ? Boolean(p.sharePasswordHash) : false,
    canAdmin,
    teamId: p.teamId,
    team: p.team,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...counts,
  }});

  // Latest project for the widget snippet. The list is sorted
  // by createdAt desc (matches the /api/projects orderBy) so
  // the first row is the latest. We fall back to a no-snippet
  // card when there are zero projects — the operator has to
  // create one to get a snippet.
  const latest = initialData[0];
  const dashboardOrigin = parseHost(process.env.DASHBOARD_HOST).origin;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Visual Feedback</h1>
            <p className="text-gray-500 mt-2">Review client feedback pins on captured page screenshots.</p>
            {/* Workspaces link. Opens /workspaces, the org / team
                index. The link is rendered above the project list
                so the dashboard reads as a "project view inside a
                workspace" rather than a parallel site. The
                transitional single-project install leaves this
                link visible to every dashboard caller — there's no
                "you must be in a team" gate on the link itself,
                only on the projects it eventually surfaces. */}
            <nav className="mt-3 flex items-center gap-3 text-sm">
              <Link
                href="/workspaces"
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                Agency & clients →
              </Link>
              {(caller.role === 'operator' || adminTeamIds.length > 0) ? (
                <Link href="/archive" className="text-blue-600 hover:text-blue-800 hover:underline">
                  Archived sites →
                </Link>
              ) : null}
            </nav>
          </div>
          {latest?.apiKey ? (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 w-full sm:w-auto min-w-0">
              <div className="text-sm text-gray-500 mb-1">Widget snippet (latest project):</div>
              <WidgetSnippet apiKey={latest.apiKey} projectId={latest.id} dashboardHost={dashboardOrigin} />
            </div>
          ) : caller.role === 'operator' ? (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-400">
              Create a project below to get a widget snippet
            </div>
          ) : (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-500">
              Review access · setup is managed by a team owner
            </div>
          )}
        </header>

        {caller.role === 'operator' ? <NewProjectForm /> : null}

        <AuthGate />

        {/* Polling client island. The server-rendered initialData
            becomes the useState seed; the island owns the 5s tick
            and the document.hidden gating. Any new pin / comment /
            annotation created by another operator shows up on the
            next tick. */}
        <DashboardPoller projects={initialData} />
      </div>
    </main>
  );
}
