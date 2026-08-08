'use client';

// DashboardPoller
//
// Client island for the dashboard home page (/) that owns the
// project list state and the 5s polling loop. The page itself
// is a React Server Component that fetches the project list via
// prisma.project.findMany on the server, then hands the result
// to <DashboardPoller projects={initialData} />. The poller
// takes it from there: it seeds useState with the server data,
// polls /api/projects every 5s for a compact replacement list, and renders the
// presentational <DashboardProjects> with the latest data.
//
// Why split this out of DashboardProjects:
//   - The home page is now an RSC. The project list is
//     server-rendered into the initial HTML, so the first
//     paint has data baked in (<100ms target). The polling
//     loop is the only piece that needs to be a client
//     component — putting it in its own island keeps the
//     RSC/server-fetch boundary clean.
//   - DashboardProjects is now a pure presentational component
//     that just renders cards. All the polling / state /
//     lifecycle lives here, in one place that's easy to
//     test in isolation (mock the fetch, assert on the
//     rendered tree after a 5s tick).
//
// Polling: a successful 5s tick against /api/projects is the source
// of truth for the home page's "updated just now / Ns ago"
// affordance. When document.hidden is true, the tick
// is skipped — there's no point burning bandwidth on a tab
// the user can't see. The detail page (/projects/[id]) runs
// its own full-detail poll loop scoped to its own projectId;
// the two are independent.
//
// Full replacement is intentional. A Project.updatedAt cursor cannot
// observe nested pin updates or deletion, while the compact DTO keeps
// the complete list small enough to refresh safely.

import { useState, useEffect, useRef, useCallback } from 'react';
import DashboardProjects from './DashboardProjects';
import type { ProjectSummary } from '@/lib/types';

export default function DashboardPoller({
  projects: initialData,
}: {
  projects: ProjectSummary[];
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialData);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Keep local state in sync when the RSC re-renders with fresh
  // initialData (e.g. after a soft navigation / revalidation).
  useEffect(() => {
    setProjects(initialData);
  }, [initialData]);

  const fetchProjects = useCallback(async () => {
    try {
      // The endpoint is a compact summary list. Fetch the whole list so nested
      // pin-count changes and project deletions cannot be missed by a parent
      // updatedAt cursor.
      const res = await fetch('/api/projects');
      if (!res.ok) {
        if (mountedRef.current) setRefreshFailed(true);
        return;
      }
      const data = await res.json();
      if (mountedRef.current) {
        setProjects(Array.isArray(data) ? (data as ProjectSummary[]) : []);
        setLastUpdated(Date.now());
        setRefreshFailed(false);
      }
    } catch {
      if (mountedRef.current) setRefreshFailed(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Don't refetch on mount — the server-rendered initialData is
    // fresh (the page just rendered it). The first poll fires at
    // the first 5s tick. The previous client-side behaviour called
    // fetchProjects() on mount, which made the server-rendered
    // initial data redundant; in the RSC model the server data IS
    // the first response, so we skip the duplicate fetch.
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

  return (
    <div>
      {refreshFailed ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <span>Updates paused. Your saved project list is still visible.</span>
          <button
            type="button"
            onClick={() => void fetchProjects()}
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100"
          >
            Retry now
          </button>
        </div>
      ) : null}
      <DashboardProjects
        projects={projects}
        lastUpdated={lastUpdated}
        onProjectUpdated={fetchProjects}
      />
    </div>
  );
}
