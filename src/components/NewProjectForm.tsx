'use client';

import { useState } from 'react';

export default function NewProjectForm() {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, domain, githubRepo: githubRepo || undefined }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to create project');
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">New Project</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Site"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
          <input
            type="text"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="example.com"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">GitHub Repo (optional)</label>
          <input
            type="text"
            value={githubRepo}
            onChange={e => setGithubRepo(e.target.value)}
            placeholder="owner/repo"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Project'}
      </button>
    </form>
  );
}