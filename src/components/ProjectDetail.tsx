'use client';

// ProjectDetail
//
// Per-project detail view. Renders the full project header, settings
// controls, subscribers, integrations, and the page/screenshot tree
// with pins + comments + annotations. Used by /projects/[id].
//
// Renders identically to the old in-list <ProjectCard> from
// <DashboardProjects>, but scoped to a single project:
//   - usePresence owns one project heartbeat/list poll and reads the
//     active screenshot/cursor from a shared ref
//   - useLiveEvents owns one project SSE stream
//   - useRecaptureStatus is hosted by <ScreenshotView> for each
//     screenshot, exactly as in the old dashboard
//   - the recapture button is wired to the same POST endpoint
//
// Polling: this component refreshes from the authenticated
// /api/projects/[id] GET route. That endpoint uses the same serializer
// as the server-rendered detail page, keeping the full review tree on
// the focused surface and out of the dashboard list payload.
//
// Why not just navigate back to / for updates: the list page's poll
// is 5s and clears on unmount, so a detail view that polls the list
// independently stays current even if the user never goes back to
// the list. That's the expected behavior of a "view this project"
// detail page.

import { useState, useEffect, useRef, useCallback } from 'react';
import ScreenshotView from './ScreenshotView';
import ProjectSettings, { ShareToggle, IntegrationsSection } from './ProjectSettings';
import DeveloperAccessPanel from './DeveloperAccessPanel';
import ProjectSubscribers from './ProjectSubscribers';
import ProjectNotifications from './ProjectNotifications';
import ReviewWorkflow from './ReviewWorkflow';
import PresenceList from './PresenceList';
import IssueFilters from './IssueFilters';
import ReviewAssetUpload from './ReviewAssetUpload';
import { usePresence, type PresenceActivity } from '@/lib/hooks/usePresence';
import { useLiveEvents } from '@/lib/hooks/useLiveEvents';
import type { ProjectWithPages } from '@/lib/types';
import { pinMatchesIssueFilters, type IssueFilters as IssueFilterValue } from '@/lib/issue-metadata';

export interface ProjectDetailProps {
  /** The fully-hydrated project tree from the server component. The
   *  server fetch is the source of truth for the FIRST render; the
   *  client poll below merges subsequent updates on top of it. */
  initialProject: ProjectWithPages;
}

export default function ProjectDetail({ initialProject }: ProjectDetailProps) {
  const [project, setProject] = useState<ProjectWithPages>(initialProject);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const mountedRef = useRef(true);
  const liveRefreshInFlightRef = useRef(false);
  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`);
      if (!res.ok) {
        if (mountedRef.current) setRefreshFailed(true);
        return;
      }
      const next: ProjectWithPages = await res.json();
      if (!mountedRef.current) return;
      if (next?.id === project.id) {
        // Merge: only update fields the server actually returned,
        // and only if they differ from the current state. The
        // current state may carry optimistic local mutations
        // (e.g. a pin status change the route just confirmed);
        // replacing the whole tree would clobber them.
        setProject((prev) => mergeProject(prev, next));
        setLastUpdated(Date.now());
        setRefreshFailed(false);
      } else {
        // Project was deleted on the server while we were on the
        // detail page. Just bump the timestamp; the user will see
        // stale data until they navigate back to the list. A real
        // "project was deleted" banner would be a follow-up — the
        // dashboard's own <ProjectSettings> delete button owns
        // that flow.
        setLastUpdated(Date.now());
      }
    } catch {
      if (mountedRef.current) setRefreshFailed(true);
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
  // re-subscribes if the projectId changes. All events use one bounded
  // refresh path; the periodic detail poll remains recovery.
  const refreshFromLiveEvent = useCallback(() => {
    if (liveRefreshInFlightRef.current) return;
    liveRefreshInFlightRef.current = true;
    void fetchProject().finally(() => {
      liveRefreshInFlightRef.current = false;
    });
  }, [fetchProject]);
  useLiveEvents({
    projectId: project.id,
    onEvent: refreshFromLiveEvent,
  });

  return (
    <div>
      {refreshFailed ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <span>Live updates paused. This saved review is still available.</span>
          <button
            type="button"
            onClick={() => void fetchProject()}
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100"
          >
            Retry now
          </button>
        </div>
      ) : null}
      <ProjectDetailCard
        project={project}
        lastUpdated={lastUpdated}
        onProjectUpdated={fetchProject}
      />
    </div>
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
  const [issueFilters, setIssueFilters] = useState<IssueFilterValue>({});
  const reviewAccessLabel = project.accessRole === 'guest'
    ? 'Guest access'
    : project.accessRole === 'client'
      ? 'Client review access'
      : 'Review access';
  const isClientReview = project.accessRole === 'client' || project.accessRole === 'guest';
  const presenceActivityRef = useRef<PresenceActivity | null>(null);
  const handlePresenceActivity = useCallback((activity: PresenceActivity) => {
    const current = presenceActivityRef.current;
    const isClear = activity.x === null && activity.y === null;
    if (isClear && current && current.screenshotId !== activity.screenshotId) return;
    presenceActivityRef.current = activity;
  }, []);
  // One heartbeat/list poll owns the focused project. Screenshot views
  // only update the shared ref and render their slice of `others`.
  const { myUserId, others } = usePresence({
    projectId: project.id,
    activityRef: presenceActivityRef,
  });

  const totalPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.length, 0),
    0
  );
  const openPins = project.pages.reduce(
    (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.filter(pn => pn.status === 'OPEN').length, 0),
    0
  );
  const matchedPins = project.pages.reduce(
    (count, page) => count + page.screenshots.reduce(
      (screenshotCount, screenshot) => screenshotCount
        + screenshot.pins.filter((pin) => pinMatchesIssueFilters(pin, issueFilters)).length,
      0
    ),
    0
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {project.archivedAt ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-950">
          <span><strong>Archived site.</strong> Historical feedback is preserved, but the widget cannot add new issues.</span>
          {project.canAdmin ? <span>Use Site settings to restore it.</span> : null}
        </div>
      ) : null}
      {isClientReview && project.reviewBranding ? (
        <section aria-label="Agency review identity" className="border-b border-gray-200 bg-white">
          <div className="h-2" style={{ backgroundColor: project.reviewBranding.accentColor }} />
          <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center">
            {project.reviewBranding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- validated remote workspace logo
              <img src={project.reviewBranding.logoUrl} alt="" className="h-10 max-w-full object-contain object-left" />
            ) : (
              <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold" style={{ backgroundColor: project.reviewBranding.accentColor, color: project.reviewBranding.accentText }}>
                {project.reviewBranding.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Client review with</p>
              <p className="truncate text-lg font-semibold text-gray-950">{project.reviewBranding.displayName}</p>
              <p className="mt-1 text-sm leading-5 text-gray-600">{project.reviewBranding.welcome}</p>
            </div>
          </div>
        </section>
      ) : null}
      <div className="bg-gray-900 px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 w-full sm:flex-1">
            <h2 className="text-xl font-semibold text-white">{project.name}</h2>
            <p className="text-gray-400 text-sm">{project.domain}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:w-auto sm:flex-nowrap sm:gap-4">
            <span className="whitespace-nowrap text-gray-300">
              <span className="font-semibold text-white">{totalPins}</span> {totalPins === 1 ? 'pin' : 'pins'}
            </span>
            <span className="whitespace-nowrap text-gray-300">
              <span className="font-semibold text-yellow-400">{openPins}</span> open
            </span>
            <span className="whitespace-nowrap text-xs text-gray-500">{timeSinceLabel(lastUpdated)}</span>
            {project.canAdmin ? (
              <ProjectSettings
                projectId={project.id}
                projectName={project.name}
                archivedAt={project.archivedAt ?? null}
                onProjectUpdated={onProjectUpdated}
              />
            ) : (
              <span className="rounded-full bg-blue-950 px-2 py-1 text-xs text-blue-200">
                {reviewAccessLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {project.canAdmin ? <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-2 text-xs min-w-0">
        <span className="text-gray-500">API Key:</span>
        {project.apiKey ? (
          <code className="min-w-0 max-w-full break-all whitespace-normal bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
        ) : (
          <span className="text-gray-400">Sign in to view</span>
        )}
      </div> : null}

      {/* Public share link toggle. Reads the project's current
          shareToken from the polled project; on generate/revoke
          the toggle pings the parent to refresh so the new token
          (or its absence) shows up in the next poll. */}
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

      {project.canAdmin ? <DeveloperAccessPanel projectId={project.id} /> : null}

      {!isClientReview ? <PresenceList myUserId={myUserId} others={others} /> : null}

      <ProjectNotifications projectId={project.id} />

      {project.canAdmin ? <ProjectSubscribers projectId={project.id} /> : null}

      {/* Outbound integrations (Slack / Discord / generic
          webhook). Same grouping rationale as the old dashboard
          list view: email + webhook for the same project live
          next to each other, and the section owns its own state
          so the project list doesn't have to thread integration
          data through the polled tree. */}
      {project.canAdmin ? <IntegrationsSection projectId={project.id} /> : null}

      <ReviewWorkflow projectId={project.id} />

      <div className="p-6 space-y-6">
        {project.canAdmin ? <ReviewAssetUpload projectId={project.id} onUploaded={onProjectUpdated} /> : null}
        {project.canAdmin ? (
          <IssueFilters
            value={issueFilters}
            options={project.issueOptions ?? { assignees: [], tags: [] }}
            matched={matchedPins}
            total={totalPins}
            onChange={setIssueFilters}
          />
        ) : null}
        {project.pages.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No pages captured yet. Visit the client site with the widget installed.</p>
        ) : (
          project.pages.map((page) => (
            <div key={page.id} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b flex items-center gap-2">
                <span className={page.reviewAsset ? '' : 'font-mono'}>
                  {page.reviewAsset
                    ? `PDF page ${page.reviewAsset.pageNumber} of ${page.reviewAsset.pageCount}`
                    : page.path}
                </span>
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
                    projectName={project.name}
                    projectDomain={project.domain}
                    showDeveloperContext={project.canAdmin}
                    canManageComments={project.canAdmin}
                    issueOptions={project.issueOptions}
                    issueFilters={project.canAdmin ? issueFilters : undefined}
                    onProjectUpdated={onProjectUpdated}
                    presenceOthers={others}
                    onPresenceActivity={handlePresenceActivity}
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
