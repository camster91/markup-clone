'use client';

// NewWorkspaceForm
//
// Client-side form for creating a workspace. Posts JSON to
// /api/workspaces and reloads the page on success so the
// server-rendered workspace list picks up the new row.
//
// We use a fetch() round-trip (rather than a plain form POST that
// navigates) so the user sees validation errors in-page instead of
// a redirect to an error page. The /api/workspaces POST handler
// returns 400 with a `{ error }` body on invalid input; we surface
// the message via `alert()` for parity with the other dashboard
// forms (NewProjectForm etc.).

import { useState } from 'react';

export default function NewWorkspaceForm() {
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
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      // On success, reload so the server-rendered list reflects the
      // new row. A router.refresh() would also work, but reload is
      // simpler and the latency is negligible.
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
        <span className="block text-sm font-medium text-gray-700 mb-1">New workspace name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder="e.g. Acme Co."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Creating…' : 'Create workspace'}
      </button>
      {error && (
        <div className="basis-full text-sm text-red-600" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
