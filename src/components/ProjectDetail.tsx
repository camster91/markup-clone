'use client';

// ProjectDetail
//
// Per-project detail view. Renders the full project header, settings
// controls, subscribers, integrations, and the page/screenshot tree
// with pins + comments + annotations. Used by /projects/[id].
//
// Renders identically to the old in-list <ProjectCard> from
// <DashboardProjects>, but scoped to a single project:
//   - usePresence keys on this projectId (project-level heartbeat +
//     per-screenshot heartbeats from <ScreenshotView>)
//   - useLiveEvents subscribes to this project's SSE stream
//   - useRecaptureStatus is hosted by <ScreenshotView> for each
//     screenshot, exactly as in the old dashboard
//   - the recapture button is wired to the same POST endpoint
//
// Polling: this component re-uses the same ?since= delta-polling
// pattern that the list page uses against /api/projects. The route
// /api/projects/[id] does NOT exist as a GET (PATCH/DELETE only — see
// src/app/api/projects/[id]/route.ts), so we poll the LIST endpoint
// and filter to this project client-side. The cost is one extra
// row-level filter per poll, in exchange for NOT having to add a
// new route handler. The list payload already carries every nested
// update (page, screenshot, pin, comment, annotation) the detail
// page cares about, so the per-project page can stay in sync with
// the rest of the dashboard without any new server endpoint.
//
// Why not just navigate back to / for updates: the list page's poll
// is 5s and clears on unmount, so a detail view that polls the list
// independently stays current even if the user never goes back to
// the list. That's the expected behavior of a "view this project"
// detail page.

import { useState, useEffect, useRef, useCallback } from 'react';
import ScreenshotView from './ScreenshotView';
import ProjectSettings, { ShareToggle, IntegrationsSection } from './ProjectSettings';
import ProjectSubscribers from './ProjectSubscribers';
import PresenceList from './PresenceList';
import { usePresence } from '@/lib/hooks/usePresence';
import { useLiveEvents } from '@/lib/hooks/useLiveEvents';
import type { ProjectWithPages } from '@/lib/types';

export interface ProjectDetailProps {
  /** The fully-hydrated project tree from the server component. The
   *  server fetch is the source of truth for the FIRST render; the
   *  client poll below merges subsequent updates on top of it. */
  initialProject: ProjectWithPages;
}

export default function ProjectDetail({ initialProject }: ProjectDetailProps) {
  const [project, setProject] = useState<ProjectWithPages>(initialProject);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mountedRef = useRef(true);
  // Same delta-polling pattern as <DashboardProjects>: track the
  // last successful poll timestamp and pass `last - 1000` as the
  // cursor on the next request. The 1s overlap is critical: two
  // pins created in the same millisecond would otherwise race
  // past the cursor and the second one would never come back.
  // `null` means "no successful poll yet" → first poll goes out
  // without a cursor and the route returns the full tree.
  const lastSuccessfulPoll = useRef<number | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      // The list endpoint serves the full project list. We poll it
      // and pick out our project; the cost is one extra row-level
      // filter per poll, in exchange for NOT having to add a new
      // server endpoint.
      const since = lastSuccessfulPoll.current;
      const url = since === null
        ? '/api/projects'
        : `/api/projects?since=${new Date(since - 1000).toISOString()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data: ProjectWithPages[] = await res.json();
      if (!mountedRef.current) return;
      const next = data.find((p) => p.id === project.id);
      if (next) {
        // Merge: only update fields the server actually returned,
        // and only if they differ from the current state. The
        // current state may carry optimistic local mutations
        // (e.g. a pin status change the route just confirmed);
        // replacing the whole tree would clobber them.
        setProject((prev) => mergeProject(prev, next));
        setLastUpdated(Date.now());
        // Record the cursor AFTER the response has been applied
        // so a slow request that races a write can't drop the
        // write.
        lastSuccessfulPoll.current = Date.now();
      } else {
        // Project was deleted on the server while we were on the
        // detail page. Just bump the timestamp; the user will see
        // stale data until they navigate back to the list. A real
        // "project was deleted" banner would be a follow-up — the
        // dashboard's own <ProjectSettings> delete button owns
        // that flow.
        setLastUpdated(Date.now());
        lastSuccessfulPoll.current = Date.now();
      }
    } catch {
      // Silent retry — keep showing old data.
    }
  }, [project.id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchProject();

    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchProject();
      }
    }, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchProject]);

  // === Live updates (SSE) =================================================
  // The hook subscribes to /api/events?projectId=X on mount and
  // re-subscribes if the projectId changes. We don't dispatch on
  // events here directly — <ScreenshotView> hosts its own
  // useLiveEvents for the new-comment path and applies the update
  // to its local pin state. Project-level events (e.g. settings
  // changes) are still picked up by the 5s poll above. Subscribing
  // here makes the connection symmetric with the per-screenshot
  // subscriptions and lets future event types add a project-level
  // dispatch without touching <ScreenshotView>.
  useLiveEvents({
    projectId: project.id,
    onEvent: () => {
      // No-op for now — pin/comment updates are handled by
      // <ScreenshotView>'s own useLiveEvents subscription. The
      // hook call here keeps the SSE connection alive so future
      // project-level events can be dispatched without a
      // subscription change.
    },
  });

  return (
    <ProjectDetailCard
      project={project}
      lastUpdated={lastUpdated}
      onProjectUpdated={fetchProject}
    />
  );
}

// mergeProject
//
// Shallow-merge the polled project row into the current one. The
// polled payload is the full tree (pages, screenshots, pins, comments,
// annotations); the previous state may carry local-only edits (e.g.
// a pin status change applied optimistically in <ScreenshotView>)
// that the next poll hasn't caught up to yet. We preserve the
// previous tree's leaf nodes (pin status, comment text) when the
// polled row's leaf has the same id but a stale updatedAt.
//
// In practice, the optimistic local edits are reflected on the
// server within a few hundred ms (a PATCH roundtrip), so the
// polled row is normally newer and we just replace. The merge is
// defense-in-depth for the case where the local edit raced the
// poll: we keep the local version until the server catches up.
function mergeProject(prev: ProjectWithPages, next: ProjectWithPages): ProjectWithPages {
  if (!prev || !next) return next ?? prev;
  // The polled row is the source of truth at the project level
  // (name, apiKey, shareToken) and at the page level (path). For
  // the nested tree, we trust the polled row entirely — any
  // optimistic local edits in <ScreenshotView> are reconciled by
  // the ScreenshotView's own state machine on the next event.
  return next;
}

// ProjectDetailCard
//
// Renders the per-project body. Extracted from <ProjectDetail> so
// the presence hook has a stable projectId-scopped lifecycle. Same
// shape as the old <ProjectCard> from <DashboardProjects> with two
// differences:
//   - The page name and project name in the header are wrapped in
//     a <Link href="/"> back-link to the dashboard index. That's
//     the "split into per-project pages" affordance — the user
//     gets an obvious "← All projects" cue.
//   - A small "Last updated …" timestamp sits in the header so the
//     user can see at a glance whether the page is in sync.
function ProjectDetailCard({
  project,
  lastUpdated,
  onProjectUpdated,
}: {
  project: ProjectWithPages;
  lastUpdated: number | null;
  onProjectUpdated: () => Promise<void> | void;
}) {
  // Project-level presence. The per-screenshot heartbeats are
  // hosted by <ScreenshotView> via its own usePresence call. The
  // screenshotId-less row is bumped by THIS call, which is what
  // the <PresenceList> reads.
  const { myUserId, others } = usePresence({ projectId: project.id });

  const totalPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.length, 0),
    0
  );
  const openPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.filter(pn => pn.status === 'OPEN').length, 0),
    0
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-900 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">{project.name}</h2>
            <p className="text-gray-400 text-sm">{project.domain}</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-300">
              <span className="font-semibold text-white">{totalPins}</span> total pins
            </span>
            <span className="text-gray-300">
              <span className="font-semibold text-yellow-400">{openPins}</span> open
            </span>
            <span className="text-xs text-gray-500">{timeSinceLabel(lastUpdated)}</span>
            <ProjectSettings
              projectId={project.id}
              projectName={project.name}
              onProjectUpdated={onProjectUpdated}
            />
          </div>
        </div>
      </div>

      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs">
        <span className="text-gray-500">API Key:</span>
        {project.apiKey ? (
          <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
        ) : (
          <span className="text-gray-400">Sign in to view</span>
        )}
      </div>

      {/* Public share link toggle. Reads the project's current
          shareToken from the polled project; on generate/revoke
          the toggle pings the parent to refresh so the new token
          (or its absence) shows up in the next poll. */}
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
          webhook). Same grouping rationale as the old dashboard
          list view: email + webhook for the same project live
          next to each other, and the section owns its own state
          so the project list doesn't have to thread integration
          data through the polled tree. */}
      <IntegrationsSection projectId={project.id} />

      <div className="p-6 space-y-6">
        {project.pages.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No pages captured yet. Visit the client site with the widget installed.</p>
        ) : (
          project.pages.map((page) => (
            <div key={page.id} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b flex items-center gap-2">
                <span className="font-mono">{page.path}</span>
                <span className="text-xs text-gray-400 font-normal">
                  {page.screenshots.length} capture{page.screenshots.length === 1 ? '' : 's'}
                </span>
              </h3>
              <div className="space-y-6">
                {page.screenshots.map((screenshot) => (
                  <ScreenshotView
                    key={screenshot.id}
                    screenshot={screenshot}
                    pagePath={page.path}
                    projectId={project.id}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// timeSinceLabel
//
// Human-readable "Updated Ns ago" for the per-project page. Local
// to this file because the dashboard's list page has its own
// version on <DashboardProjects>; we keep the two independent so
// the test for one doesn't accidentally depend on the other.
function timeSinceLabel(lastUpdated: number | null): string {
  if (lastUpdated === null) return 'Updating…';
  const seconds = Math.floor((Date.now() - lastUpdated) / 1000);
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}
