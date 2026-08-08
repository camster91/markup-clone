'use client';

// NewTeamForm
//
// Client-side form for creating a team inside a workspace. Posts
// JSON to /api/workspaces/[id]/teams and reloads the page on
// success so the server-rendered team list picks up the new row.

import { useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

export default function NewTeamForm({ workspaceId }: { workspaceId: string }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-end gap-3 flex-wrap"
    >
      <label className="flex-1 min-w-[12rem]">
        <span className="block text-sm font-medium text-gray-700 mb-1">New client account</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder="e.g. Acme Corporation"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Creating…' : 'Create client'}
      </button>
      {error && (
        <div className="basis-full text-sm text-red-600" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
