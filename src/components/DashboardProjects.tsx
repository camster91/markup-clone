'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import CopyButton from './CopyButton';
import ScreenshotView from './ScreenshotView';
import ProjectSettings, { ShareToggle, IntegrationsSection } from './ProjectSettings';
import ProjectSubscribers from './ProjectSubscribers';
import PresenceList from './PresenceList';
import { usePresence } from '@/lib/hooks/usePresence';
import type { ProjectWithPages } from '@/lib/types';

export default function DashboardProjects() {
  const [projects, setProjects] = useState<ProjectWithPages[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  // Timestamp (ms since epoch) of the last successful /api/projects
  // response. The route accepts ?since=<ISO> and returns only rows whose
  // updatedAt is strictly after the cursor, so the next poll passes
  // `lastSuccessfulPoll - 1000` (1s overlap) as the cursor. The 1s
  // overlap is critical: two pins created in the same millisecond would
  // otherwise race past the cursor and the second one would never come
  // back. `null` means "no successful poll yet" → first poll goes out
  // without a cursor and the route returns the full tree.
  const lastSuccessfulPoll = useRef<number | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      // First poll: no cursor, full tree. Subsequent polls: pass the
      // last successful poll timestamp minus 1s so we don't miss rows
      // that were updated in the same millisecond as the previous
      // response was being serialized.
      const since = lastSuccessfulPoll.current;
      const url = since === null
        ? '/api/projects'
        : `/api/projects?since=${new Date(since - 1000).toISOString()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setProjects(data);
        setLastUpdated(Date.now());
        // Record the cursor AFTER the response has been applied so a
        // slow request that races a write can't drop the write.
        lastSuccessfulPoll.current = Date.now();
      }
    } catch {
      // silent retry - keep showing old data
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchProjects();

    intervalRef.current = setInterval(() => {
      if (!document.hidden) {
        fetchProjects();
      }
    }, 5000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchProjects]);

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
      <div className="space-y-8">
        {projects.map(project => (
          <ProjectCard
            key={project.id}
            project={project}
            onProjectUpdated={fetchProjects}
          />
        ))}
      </div>
    </div>
  );
}

// ProjectCard
//
// One project in the dashboard. Extracted from DashboardProjects so
// the usePresence() hook has a project-scoped lifecycle (mount/unmount
// when the project list changes). Each project gets its own presence
// heartbeat + poll; if the project list reorders or grows, the
// existing instances stay alive. The hook is keyed on projectId, so
// re-keying (e.g. after a project delete) cleanly tears down the old
// heartbeat and starts a new one for the new key.
function ProjectCard({
  project,
  onProjectUpdated,
}: {
  project: ProjectWithPages;
  onProjectUpdated: () => Promise<void> | void;
}) {
  // usePresence runs the heartbeat + poll for THIS project. We don't
  // pass a cursorRef at this level — that's the per-screenshot concern
  // handled inside <ScreenshotView>. The presence row's cursor fields
  // will simply be null (no cursor) until a screenshot reports a
  // position via its own usePresence call.
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
        <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
        <CopyButton text={project.apiKey} />
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

      <div className="p-6 space-y-6">
        {project.pages.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No pages captured yet. Visit the client site with the widget installed.</p>
        ) : (
          project.pages.map(page => (
            <div key={page.id} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b flex items-center gap-2">
                <span className="font-mono">{page.path}</span>
                <span className="text-xs text-gray-400 font-normal">
                  {page.screenshots.length} capture{page.screenshots.length === 1 ? '' : 's'}
                </span>
              </h3>
              <div className="space-y-6">
                {page.screenshots.map(screenshot => (
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
