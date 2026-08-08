'use client';

import { useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

export default function NewProjectForm({ teamId }: { teamId?: string }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ name, domain, ...(teamId ? { teamId } : {}) }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError((data as { error?: string }).error || 'Failed to create project');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">New site</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="project-name" className="block text-sm font-medium text-gray-700 mb-1">Site name</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Client Site"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="project-domain" className="block text-sm font-medium text-gray-700 mb-1">
            Client Domain
            <span className="text-gray-400 font-normal ml-1">(e.g. example.com — where the widget will run)</span>
          </label>
          <input
            id="project-domain"
            type="text"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="example.com"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mt-2">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create site'}
      </button>
    </form>
  );
}
