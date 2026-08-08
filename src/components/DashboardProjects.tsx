'use client';

// DashboardProjects
//
// Presentational list view for the dashboard home page (/).
// Renders a COMPACT card per project — name, domain, pin counts,
// last-updated timestamp, and a clickable link to the per-project
// detail page at /projects/[id].
//
// Why presentational (props-driven) now: the dashboard home moved
// to a React Server Component pattern. The page (an RSC) fetches
// the project list via prisma.project.findMany and hands the
// initial tree to <DashboardPoller>. DashboardPoller is the
// polling island — it owns the useState<projects> + 5s setInterval
// + document.hidden gating. DashboardProjects just renders whatever
// it's given. This split keeps the first paint fast (the list is
// server-rendered into the initial HTML) and concentrates all the
// polling logic in one place that's easy to test in isolation.
//
// Why a compact card here and a full tree at /projects/[id]:
//   - The dashboard home used to inline the full project tree
//     (every page, screenshot, pin, comment). That made the home
//     page render-heavy and slow to scan when a workspace has
//     many projects.
//   - Splitting the detail onto /projects/[id] keeps the home
//     page scannable — operators see the project list and
//     pin counts at a glance, and dive into a project for the
//     full screenshot / pin tree.
//   - The per-project detail is hosted by <ProjectDetail>, which
//     starts collaboration presence/live events only after the user
//     enters a project. The two pages
//     share the same component composition; only the wrapper
//     changes (list of compact cards vs. single full tree).
//
// `lastUpdated` is the timestamp (ms since epoch) of the latest
// fetched projects. <DashboardPoller> is the one that drives
// updates — when the poll succeeds, it bumps `lastUpdated` and
// passes both props down. DashboardProjects uses the value to
// render the "Updated just now / Ns ago" affordance.

import Link from 'next/link';
import CopyButton from './CopyButton';
import ProjectSettings, { ShareToggle, IntegrationsSection } from './ProjectSettings';
import ProjectSubscribers from './ProjectSubscribers';
import type { ProjectSummary } from '@/lib/types';

export default function DashboardProjects({
  projects,
  lastUpdated,
  onProjectUpdated,
}: {
  projects: ProjectSummary[];
  lastUpdated: number | null;
  onProjectUpdated: () => Promise<void> | void;
}) {
  const getTimeSinceUpdate = () => {
    if (lastUpdated === null) return 'Updating…';
    const seconds = Math.floor((Date.now() - lastUpdated) / 1000);
    // 0-4s: "just now" (smoother than "0s ago" / "1s ago" / "2s ago")
    if (seconds < 5) return 'Updated just now';
    // 5-59s: "Ns ago"
    if (seconds < 60) return `Updated ${seconds}s ago`;
    // 1-59m: "Nm ago"
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Updated ${minutes}m ago`;
    // 1h+: "Nh ago"
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Updated ${hours}h ago`;
    // 1d+: "Nd ago"
    const days = Math.floor(hours / 24);
    return `Updated ${days}d ago`;
  };

  if (projects.length === 0) {
    return (
      <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">No active sites</h3>
        <p className="text-gray-500 mt-2">Create a site above, or restore completed work from the archive.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <span className="text-xs text-gray-400">{getTimeSinceUpdate()}</span>
      </div>
      <div className="space-y-4">
        {projects.map(project => (
          <ProjectListCard
            key={project.id}
            project={project}
            onProjectUpdated={onProjectUpdated}
          />
        ))}
      </div>
    </div>
  );
}

// ProjectListCard
//
// Compact summary card for the dashboard home page. Shows the
// project name (as a link to /projects/[id]), domain, pin counts,
// share-link toggle, settings menu, and the
// per-project sub-components (subscribers, integrations) that
// operators expect to find on the dashboard. The full screenshot
// / pin / comment tree has been moved to /projects/[id].
//
// The compact card is what the operator scans to find the
// project they want to review; clicking the name (or the
// "Open project →" affordance) navigates to the per-project
// page for the full tree. This split keeps the home page
// snappy (less HTML, fewer re-renders) and makes deep links
// stable (a per-project URL is bookmarkable / shareable).
function ProjectListCard({
  project,
  onProjectUpdated,
}: {
  project: ProjectSummary;
  onProjectUpdated: () => Promise<void> | void;
}) {
  // Presence intentionally starts only after opening this project.
  // The overview is not a truthful signal that the user is reviewing
  // every visible site and must not heartbeat into each card.
  const { totalPins, openPins, totalScreenshots, totalPages } = project;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-900 px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 w-full sm:flex-1">
            {/* The project name is the primary "open this project"
                affordance. We render it as a <Link> to
                /projects/[id] so deep-linking + right-click-open-
                in-new-tab work. The "Open project →" link in
                the body below is a secondary affordance for
                users who scan to the body before the header. */}
            <Link
              href={`/projects/${project.id}`}
              className="text-xl font-semibold text-white hover:underline focus:underline focus:outline-none"
            >
              {project.name}
            </Link>
            <p className="text-gray-400 text-sm truncate">{project.domain}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:w-auto sm:flex-nowrap sm:gap-4">
            <span className="whitespace-nowrap text-gray-300">
              <span className="font-semibold text-white">{totalPins}</span> {totalPins === 1 ? 'pin' : 'pins'}
            </span>
            <span className="whitespace-nowrap text-gray-300">
              <span className="font-semibold text-yellow-400">{openPins}</span> open
            </span>
            {project.canAdmin ? (
              <ProjectSettings
                projectId={project.id}
                projectName={project.name}
                archivedAt={project.archivedAt}
                onProjectUpdated={onProjectUpdated}
              />
            ) : (
              <span className="rounded-full bg-blue-950 px-2 py-1 text-xs text-blue-200">
                Review access
              </span>
            )}
          </div>
        </div>
      </div>

      {project.canAdmin ? <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs flex-wrap min-w-0">
        <span className="text-gray-500">API Key:</span>
        {project.apiKey ? (
          <>
            <code className="min-w-0 max-w-full break-all whitespace-normal bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
            <CopyButton text={project.apiKey} />
          </>
        ) : (
          <span className="text-gray-400">Sign in to view</span>
        )}
        <span className="text-gray-300 mx-1">·</span>
        <span className="text-gray-500">
          {totalPages} page{totalPages === 1 ? '' : 's'} · {totalScreenshots} capture{totalScreenshots === 1 ? '' : 's'}
        </span>
        <span className="ml-auto">
          <Link
            href={`/projects/${project.id}`}
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            Open site →
          </Link>
        </span>
      </div> : (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-6 py-3 text-xs text-gray-500">
          <span>{totalPages} page{totalPages === 1 ? '' : 's'} · {totalScreenshots} capture{totalScreenshots === 1 ? '' : 's'}</span>
          <Link href={`/projects/${project.id}`} className="ml-auto font-medium text-blue-700 hover:text-blue-900 hover:underline">
            Open review →
          </Link>
        </div>
      )}

      {/* Public share link toggle. Reads the project's current
          shareToken from the polled project list; on generate/revoke
          the toggle pings the parent to refresh so the new token
          (or its absence) shows up in the next poll. The shareUrl
          is built from the dashboard's origin so a copied link
          works on the same host the user is currently on. */}
      {project.canAdmin ? <div className="px-6 pt-3 pb-0">
        <ShareToggle
          projectId={project.id}
          hasShareToken={!!project.shareToken}
          shareUrl={project.shareToken ? `/share/${project.shareToken}/open` : null}
          shareExpiresAt={project.shareExpiresAt}
          sharePasswordProtected={project.sharePasswordProtected}
          onChange={onProjectUpdated}
        />
      </div> : null}

      {project.canAdmin ? <ProjectSubscribers projectId={project.id} /> : null}

      {/* Outbound integrations (Slack / Discord / generic
          webhook). Rendered just below the subscribers block
          so the two "external notification" surfaces are
          grouped — the operator configures email + webhook
          for the same project, and grouping them makes the
          mental model obvious. Like the subscribers block,
          the section owns its own state; the dashboard does
          not need to thread integration data through the
          project list (which would couple two unrelated
          concerns and force a poll on every integration
          change). The IntegrationsSection component fetches
          its own list on mount. */}
      {project.canAdmin ? <IntegrationsSection projectId={project.id} /> : null}
    </div>
  );
}
