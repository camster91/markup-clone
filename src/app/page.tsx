import NewProjectForm from '@/components/NewProjectForm';
import WidgetSnippet from '@/components/WidgetSnippet';
import DashboardProjects from '@/components/DashboardProjects';
import AuthGate from '@/components/AuthGate';
import { prisma } from '@/lib/prisma';

// / (dashboard home)
//
// List-only view. The home page is a thin wrapper around the
// <DashboardProjects> client component, which polls /api/projects
// for the project list and renders each project as a compact card
// with a link to the per-project detail page at /projects/[id].
//
// The previous in-line per-project detail (every page, every
// screenshot, every pin) was moved to /projects/[id] (see
// src/app/projects/[id]/page.tsx). That refactor keeps the home
// page scannable when a workspace has many projects, and gives
// every project a stable deep link.
//
// We still need a server-side fetch to render the widget snippet
// for the LATEST project — the snippet is the
// `<script src=".../widget.js" data-api-key="..." />` block the
// operator pastes into the client site. The snippet needs the
// project's apiKey and id, both of which are dashboard-side
// scalars that don't depend on the screenshot tree. The full
// per-project tree (pages / screenshots / pins) is NOT loaded on
// the home page — it's only loaded by the per-project route.

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  // Lightweight fetch: just the latest project's apiKey and id.
  // We don't need the full project tree on the home page (that
  // lives at /projects/[id]).
  const latest = await prisma.project.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, apiKey: true },
  });

  const dashboardHost = process.env.DASHBOARD_HOST || 'markup.ashbi.ca';

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Visual Feedback</h1>
            <p className="text-gray-500 mt-2">Review client feedback pins on captured page screenshots.</p>
          </div>
          {latest?.apiKey ? (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-500 mb-1">Widget snippet (latest project):</div>
              <WidgetSnippet apiKey={latest.apiKey} projectId={latest.id} dashboardHost={`https://${dashboardHost}`} />
            </div>
          ) : (
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-400">
              Create a project below to get a widget snippet
            </div>
          )}
        </header>

        <NewProjectForm />

        <AuthGate />

        <DashboardProjects />
      </div>
    </div>
  );
}
