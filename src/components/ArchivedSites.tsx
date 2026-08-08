'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dashboardHeaders } from '@/lib/client-origin';
import type { ProjectSummary } from '@/lib/types';

export default function ArchivedSites({ projects: initialProjects }: { projects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (project: ProjectSummary) => {
    setBusyId(project.id);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ archived: false }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || 'Could not restore site');
      }
      setProjects((current) => current.filter(({ id }) => id !== project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore site');
    } finally {
      setBusyId(null);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Archive is empty</h2>
        <p className="mt-2 text-sm text-gray-500">Completed sites can be archived from their settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {projects.map((project) => (
        <article key={project.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/projects/${project.id}`} className="font-semibold text-gray-950 hover:text-blue-700 hover:underline">
                  {project.name}
                </Link>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">Archived</span>
              </div>
              <p className="mt-1 truncate text-sm text-gray-500">{project.domain}</p>
              {project.team ? <p className="mt-1 text-xs text-gray-500">Client: {project.team.name}</p> : null}
              <p className="mt-2 text-xs text-gray-500">
                {project.totalPages} page{project.totalPages === 1 ? '' : 's'} · {project.totalPins} issue{project.totalPins === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              disabled={busyId === project.id}
              onClick={() => void restore(project)}
              className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              {busyId === project.id ? 'Restoring…' : 'Restore site'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
