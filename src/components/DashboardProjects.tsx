'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import CopyButton from './CopyButton';
import ScreenshotView from './ScreenshotView';
import ProjectSettings from './ProjectSettings';
import ProjectSubscribers from './ProjectSubscribers';
import type { ProjectWithPages } from '@/lib/types';

export default function DashboardProjects() {
  const [projects, setProjects] = useState<ProjectWithPages[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setProjects(data);
        setLastUpdated(Date.now());
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
    if (!lastUpdated) return 'Updating…';
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
        {projects.map(project => {
          const totalPins = project.pages.reduce(
            (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.length, 0),
            0
          );
          const openPins = project.pages.reduce(
            (acc, p) => acc + p.screenshots.reduce((a, s) => a + s.pins.filter(pn => pn.status === 'OPEN').length, 0),
            0
          );
          return (
            <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                      onProjectUpdated={fetchProjects}
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs">
                <span className="text-gray-500">API Key:</span>
                <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
                <CopyButton text={project.apiKey} />
              </div>

              <ProjectSubscribers projectId={project.id} />

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
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
