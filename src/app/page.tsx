import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
import DashboardPoller from '@/components/DashboardPoller';
import AuthGate from '@/components/AuthGate';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import type { ProjectWithPages } from '@/lib/types';
import { getCallerUser, getProjectScopeWhere } from '@/lib/teams';

// / (dashboard home)
//
// React Server Component. The home page is a thin server-rendered
// shell that:
//   1. Fetches the project list via prisma.project.findMany
//      (same include shape as /api/projects, minus the
//      since= delta filter — we want the full tree for the
//      first paint).
//   2. Renders <NewProjectForm> (a client component) for the
//      create flow.
//   3. Renders <AuthGate> (a client component) for the session
//      modal — this is the canonical auth gate for the
//      dashboard origin.
//   4. Renders <DashboardPoller projects={initialData}>, the
//      client island that owns the 5s polling loop and renders
//      <DashboardProjects> with the latest data.
//
// Why an RSC: the project list is small (projects → pages →
// screenshots → pins) and the dashboard is a list-and-form
// page. The first paint carries the project list baked into
// the HTML so the operator sees their projects on the first
// frame — no loading flash, no JS-required state hydration.
// The client island <DashboardPoller> takes over from there:
// it owns the live state and the 5s poll, and any new pin
// / comment / annotation created by another operator shows
// up on the next tick.
//
// The full per-project tree (pages / screenshots / pins /
// comments / annotations) is rendered into the initial HTML
// for every project the caller can see. For a transitional
// single-project install that's trivially small. For a
// workspace with many projects, this can grow — the per-
// project detail page (/projects/[id]) exists so the home
// page doesn't have to inline the deep tree. We still embed
// the full tree in the home page's first paint because the
// polling island needs the full payload to render the
// "N pins / M open" affordance without a follow-up fetch.
//
// Team-scope: the same helper that gates /api/projects'
// team-scope filter (getProjectScopeWhere) gates this RSC's
// fetch. A caller with team memberships sees their teams'
// projects; a caller with no memberships sees the legacy /
// unscoped (teamId IS NULL) projects. The dashboard's
// <AuthGate> handles the "no session at all" case via the
// login modal.
//
// Widget snippet: the page still renders the snippet for
// the latest project (by createdAt desc). The snippet is
// the `<script src=".../widget.js" data-api-key="..." />`
// block the operator pastes into the client site. We
// derive the latest project's apiKey + id from the full
// list (the first row of the sorted findMany is the latest
// project) — no second DB query needed.
//
// force-dynamic: a new project / a new pin should appear on
// the next page load, not after a cache TTL. The RSC fetches
// on every request; the 5s polling island picks up deltas
// after the first paint.

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  // Server-side fetch. Same shape as /api/projects' full
  // response so the client island doesn't need a follow-up
  // "full" fetch — its first poll is the delta against this.
  //
  // Team-scope filter: callers see projects whose team is one
  // they belong to (and legacy / unscoped projects when they
  // have no team memberships). Mirrors the /api/projects
  // route's where clause so the first paint matches what the
  // polling client will see on its first delta.
  const caller = await getCallerUser();
  const teamScope = await getProjectScopeWhere(caller?.id ?? null);

  const projects = await prisma.project.findMany({
    where: teamScope,
    include: {
      pages: {
        orderBy: { createdAt: 'asc' },
        include: {
          screenshots: {
            orderBy: { capturedAt: 'desc' },
            include: {
              pins: {
                orderBy: { createdAt: 'asc' },
                include: {
                  comments: {
                    orderBy: { createdAt: 'asc' },
                  },
                  annotations: {
                    orderBy: { createdAt: 'asc' },
                  },
                },
              },
            },
          },
        },
      },
      subscribers: true,
      team: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

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
  const includeSecrets = caller !== null;
  const initialData: ProjectWithPages[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    apiKey: includeSecrets ? p.apiKey : null,
    shareToken: includeSecrets ? p.shareToken : null,
    teamId: p.teamId,
    team: p.team,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    pages: p.pages.map((page) => ({
      id: page.id,
      path: page.path,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      screenshots: page.screenshots.map((screenshot) => ({
        id: screenshot.id,
        storageKey: screenshot.storageKey,
        pageId: screenshot.pageId,
        width: screenshot.width,
        height: screenshot.height,
        capturedAt: screenshot.capturedAt.toISOString(),
        pins: screenshot.pins.map((pin) => ({
          id: pin.id,
          xPercent: pin.xPercent,
          yPercent: pin.yPercent,
          status: pin.status,
          elementXPath: pin.elementXPath,
          elementHTML: pin.elementHTML,
          createdAt: pin.createdAt.toISOString(),
          comments: pin.comments.map((comment) => ({
            id: comment.id,
            text: comment.text,
            author: comment.author,
            authorRole: comment.authorRole,
            createdAt: comment.createdAt.toISOString(),
            attachments: [],
          })),
          annotations: (pin.annotations ?? []).map((annotation) => {
            let path: number[][] = [];
            try {
              const parsed = JSON.parse(annotation.pathJson);
              if (Array.isArray(parsed)) path = parsed as number[][];
            } catch {
              // Bad pathJson (would have been rejected at write
              // time). Fall back to an empty path so the
              // ScreenshotView doesn't throw.
            }
            return {
              id: annotation.id,
              kind: annotation.kind as 'arrow' | 'box' | 'freehand',
              path,
              createdAt: annotation.createdAt.toISOString(),
            };
          }),
        })),
      })),
    })),
    subscribers: p.subscribers.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      email: s.email,
      createdAt: s.createdAt.toISOString(),
    })),
  }));

  // Latest project for the widget snippet. The list is sorted
  // by createdAt desc (matches the /api/projects orderBy) so
  // the first row is the latest. We fall back to a no-snippet
  // card when there are zero projects — the operator has to
  // create one to get a snippet.
  const latest = initialData[0];
  const dashboardHost = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

  return (
    <div className="min-h-screen bg-gray-50 p-8">
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
                Workspaces →
              </Link>
            </nav>
          </div>
          {includeSecrets && latest?.apiKey ? (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-500 mb-1">Widget snippet (latest project):</div>
              <WidgetSnippet apiKey={latest.apiKey} projectId={latest.id} dashboardHost={`https://${dashboardHost}`} />
            </div>
          ) : (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-400">
              {includeSecrets
                ? 'Create a project below to get a widget snippet'
                : 'Sign in to see the widget snippet'}
            </div>
          )}
        </header>

        <NewProjectForm />

        <AuthGate />

        {/* Polling client island. The server-rendered initialData
            becomes the useState seed; the island owns the 5s tick
            and the document.hidden gating. Any new pin / comment /
            annotation created by another operator shows up on the
            next tick. */}
        <DashboardPoller projects={initialData} />
      </div>
    </div>
  );
}
