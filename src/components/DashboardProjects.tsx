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
//     re-uses the same ScreenshotView / PinThread / usePresence /
//     useLiveEvents / useRecaptureStatus hooks. The two pages
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
import PresenceList from './PresenceList';
import { usePresence } from '@/lib/hooks/usePresence';
import type { ProjectWithPages } from '@/lib/types';

export default function DashboardProjects({
  projects,
  lastUpdated,
  onProjectUpdated,
}: {
  projects: ProjectWithPages[];
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
        <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
        <p className="text-gray-500 mt-2">Create a project above, then install the widget snippet on the client site.</p>
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
// share-link toggle, presence strip, settings menu, and the
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
  project: ProjectWithPages;
  onProjectUpdated: () => Promise<void> | void;
}) {
  // usePresence runs the heartbeat + poll for THIS project. We don't
  // pass a cursorRef at this level — that's the per-screenshot concern
  // handled inside <ScreenshotView> on the detail page. The presence
  // row's cursor fields will simply be null (no cursor) until a
  // screenshot reports a position via its own usePresence call.
  // We keep the call here so the "Online now" strip on the home
  // page reflects who's currently looking at this project — even
  // when the operator is on the LIST page, not the detail page.
  const { myUserId, others } = usePresence({ projectId: project.id });

  const totalPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.length, 0),
    0
  );
  const openPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.filter(pn => pn.status === 'OPEN').length, 0),
    0
  );
  const totalScreenshots = project.pages.reduce(
    (acc, p) => acc + p.screenshots.length,
    0
  );
  const totalPages = project.pages.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-900 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
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
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-300">
              <span className="font-semibold text-white">{totalPins}</span> total pins
            </span>
            <span className="text-gray-300">
              <span className="font-semibold text-yellow-400">{openPins}</span> open
            </span>
            <ProjectSettings
              projectId={project.id}
              projectName={project.name}
              onProjectUpdated={onProjectUpdated}
            />
          </div>
        </div>
      </div>

      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-gray-500">API Key:</span>
        <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
        <CopyButton text={project.apiKey} />
        <span className="text-gray-300 mx-1">·</span>
        <span className="text-gray-500">
          {totalPages} page{totalPages === 1 ? '' : 's'} · {totalScreenshots} capture{totalScreenshots === 1 ? '' : 's'}
        </span>
        <span className="ml-auto">
          <Link
            href={`/projects/${project.id}`}
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            Open project →
          </Link>
        </span>
      </div>

      {/* Public share link toggle. Reads the project's current
          shareToken from the polled project list; on generate/revoke
          the toggle pings the parent to refresh so the new token
          (or its absence) shows up in the next poll. The shareUrl
          is built from the dashboard's origin so a copied link
          works on the same host the user is currently on. */}
      <div className="px-6 pt-3 pb-0">
        <ShareToggle
          projectId={project.id}
          hasShareToken={!!project.shareToken}
          shareUrl={
            project.shareToken && typeof window !== 'undefined'
              ? `${window.location.origin}/share/${project.shareToken}`
              : null
          }
          onChange={onProjectUpdated}
        />
      </div>

      <PresenceList myUserId={myUserId} others={others} />

      <ProjectSubscribers projectId={project.id} />

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
      <IntegrationsSection projectId={project.id} />
    </div>
  );
}
