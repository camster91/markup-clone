'use client';

// DashboardPoller
//
// Client island for the dashboard home page (/) that owns the
// project list state and the 5s polling loop. The page itself
// is a React Server Component that fetches the project list via
// prisma.project.findMany on the server, then hands the result
// to <DashboardPoller projects={initialData} />. The poller
// takes it from there: it seeds useState with the server data,
// polls /api/projects every 5s for deltas, and renders the
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
// Polling: the 5s tick against /api/projects, with
// `lastSuccessfulPoll - 1000` as the cursor, is still the
// source of truth for the home page's "updated just now /
// Ns ago" affordance. When document.hidden is true, the tick
// is skipped — there's no point burning bandwidth on a tab
// the user can't see. The detail page (/projects/[id]) runs
// its own identical poll loop scoped to its own projectId;
// the two are independent.
//
// Delta merge: when `?since=` is set the route returns only
// rows updated after the cursor — NOT a full replacement.
// We upsert those rows into the existing list by id. An empty
// delta must leave the list unchanged (replacing with [] would
// wipe the dashboard). A full fetch (since === null) may
// replace.

import { useState, useEffect, useRef, useCallback } from 'react';
import DashboardProjects from './DashboardProjects';
import type { ProjectWithPages } from '@/lib/types';

/** Upsert delta projects into the existing list by id. Preserves
 *  order of existing rows; appends brand-new ids at the end. */
function mergeProjectsById(
  prev: ProjectWithPages[],
  delta: ProjectWithPages[]
): ProjectWithPages[] {
  if (delta.length === 0) return prev;
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const p of delta) {
    byId.set(p.id, p);
  }
  const existingIds = new Set(prev.map((p) => p.id));
  const updated = prev.map((p) => byId.get(p.id)!);
  for (const p of delta) {
    if (!existingIds.has(p.id)) updated.push(p);
  }
  return updated;
}

export default function DashboardPoller({
  projects: initialData,
}: {
  projects: ProjectWithPages[];
}) {
  const [projects, setProjects] = useState<ProjectWithPages[]>(initialData);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Keep local state in sync when the RSC re-renders with fresh
  // initialData (e.g. after a soft navigation / revalidation).
  useEffect(() => {
    setProjects(initialData);
  }, [initialData]);

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
        if (since === null) {
          // Full fetch — replace.
          setProjects(Array.isArray(data) ? data : []);
        } else {
          // Delta — upsert by id; empty delta leaves the list unchanged.
          const delta = Array.isArray(data) ? (data as ProjectWithPages[]) : [];
          if (delta.length > 0) {
            setProjects((prev) => mergeProjectsById(prev, delta));
          }
        }
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
    <DashboardProjects
      projects={projects}
      lastUpdated={lastUpdated}
      onProjectUpdated={fetchProjects}
    />
  );
}
