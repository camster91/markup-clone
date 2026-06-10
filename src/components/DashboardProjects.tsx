'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import CommentCard from './CommentCard';
import CopyButton from './CopyButton';

export default function DashboardProjects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
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
        setIsStale(false);
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

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsStale(true);
      } else {
        setIsStale(false);
        fetchProjects();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchProjects]);

  const getTimeSinceUpdate = () => {
    if (!lastUpdated) return 'Updating...';
    const seconds = Math.floor((Date.now() - lastUpdated) / 1000);
    if (seconds < 5) return `Last updated ${seconds}s ago`;
    return 'Updating...';
  };

  if (projects.length === 0) {
    return (
      <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
        <p className="text-gray-500 mt-2">Install the widget snippet on a client site to capture the first pin.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <span className="text-xs text-gray-400">{getTimeSinceUpdate()}</span>
      </div>
      <div className="space-y-8">
        {projects.map((project: any) => (
          <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                  <p className="text-gray-400 text-sm">{project.domain}</p>
                </div>
                {project.githubRepo && (
                  <a href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-white text-sm flex items-center gap-1">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    {project.githubRepo}
                  </a>
                )}
              </div>
            </div>

            {project.apiKey && (
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2 text-xs">
                <span className="text-gray-500">API Key:</span>
                <code className="bg-white px-2 py-1 rounded border border-gray-200 font-mono">{project.apiKey}</code>
                <CopyButton text={project.apiKey} />
              </div>
            )}

            <div className="p-6">
              {project.pages?.map((page: any) => (
                <div key={page.id} className="mb-8 last:mb-0">
                  <h3 className="text-lg font-medium text-gray-800 mb-4 border-b pb-2">Path: {page.path}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {page.comments?.map((comment: any) => (
                      <CommentCard key={comment.id} comment={comment} />
                    ))}
                    {(!page.comments || page.comments.length === 0) && (
                      <p className="text-sm text-gray-500 italic">No feedback pins on this page yet.</p>
                    )}
                  </div>
                </div>
              ))}
              {(!project.pages || project.pages.length === 0) && (
                <p className="text-sm text-gray-500 italic">No pages captured yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
