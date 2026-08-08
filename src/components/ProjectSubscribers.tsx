'use client';

import { useCallback, useState, useEffect } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

type ProjectSubscribersProps = {
  projectId: string;
};

export default function ProjectSubscribers({ projectId }: ProjectSubscribersProps) {
  const [expanded, setExpanded] = useState(false);
  const [subscribers, setSubscribers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscribers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/subscribers`, {
        headers: dashboardHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSubscribers(Array.isArray(data) ? data : (data.subscribers ?? []));
      }
    } catch {
      setError('Failed to load subscribers');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (expanded && subscribers.length === 0) {
      fetchSubscribers();
    }
    // fetchSubscribers is stable (useCallback keyed on projectId); subscribers.length
    // is intentionally omitted — including it would re-fire fetchSubscribers() every
    // time the list updates, which would clobber optimistic UI in handleAdd/handleRemove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, projectId, fetchSubscribers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/subscribers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      if (res.ok) {
        setNewEmail('');
        fetchSubscribers();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to add subscriber');
      }
    } catch {
      setError('Failed to add subscriber');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (email: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/subscribers/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: dashboardHeaders(),
      });
      if (res.ok) {
        fetchSubscribers();
      } else {
        setError('Failed to remove subscriber');
      }
    } catch {
      setError('Failed to remove subscriber');
    }
  };

  return (
    <div className="border-t border-gray-100">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls={`subscribers-${projectId}`}
        className="w-full px-6 py-3 flex items-center justify-between text-sm text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className="text-left">
            <span className="block font-medium text-gray-800">External new-feedback alerts</span>
            <span className="block text-xs text-gray-500">Email addresses without a project account.</span>
          </span>
          {subscribers.length > 0 && (
            <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs">{subscribers.length}</span>
          )}
        </span>
        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div id={`subscribers-${projectId}`} className="px-6 pb-4">
          {loading ? (
            <p className="text-sm text-gray-400 py-2">Loading...</p>
          ) : error ? (
            <p className="text-sm text-red-500 py-2">{error}</p>
          ) : subscribers.length === 0 ? (
            <p className="text-sm text-gray-400 py-2 italic">No subscribers yet.</p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {subscribers.map(email => (
                <li key={email} className="flex items-center justify-between text-sm bg-gray-50 px-3 py-1.5 rounded">
                  <span className="truncate">{email}</span>
                  <button
                    onClick={() => handleRemove(email)}
                    className="ml-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                    aria-label={`Remove ${email}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add subscriber form */}
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="email"
              aria-label="Subscriber email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="subscriber@example.com"
              className="flex-1 text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              type="submit"
              disabled={adding || !newEmail.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
