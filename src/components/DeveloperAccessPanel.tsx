'use client';

import { useCallback, useEffect, useState } from 'react';
import CopyButton from './CopyButton';
import { dashboardHeaders } from '@/lib/client-origin';

type SafeToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenLastFour: string;
  scope: 'issues:read';
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

function safeToken(value: unknown): SafeToken | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string'
    || row.tokenPrefix !== 'mkv1_' || typeof row.tokenLastFour !== 'string'
    || row.scope !== 'issues:read' || typeof row.createdAt !== 'string') return null;
  return {
    id: row.id, name: row.name, tokenPrefix: 'mkv1_', tokenLastFour: row.tokenLastFour,
    scope: 'issues:read',
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
    lastUsedAt: typeof row.lastUsedAt === 'string' ? row.lastUsedAt : null,
    createdAt: row.createdAt,
  };
}

export default function DeveloperAccessPanel({ projectId }: { projectId: string }) {
  const [tokens, setTokens] = useState<SafeToken[]>([]);
  const [name, setName] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/api-tokens`, { headers: dashboardHeaders() });
      if (!response.ok) throw new Error('Could not load developer tokens');
      const body: unknown = await response.json();
      setTokens(Array.isArray(body) ? body.map(safeToken).filter((row): row is SafeToken => Boolean(row)) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load developer tokens');
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59.000Z`).toISOString() : null;
      const response = await fetch(`/api/projects/${projectId}/api-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ name: name.trim(), expiresAt, scope: 'issues:read' }),
      });
      const body = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(body.error || 'Could not create developer token');
      const token = safeToken(body.token);
      if (!token || typeof body.secret !== 'string') throw new Error('Server returned an invalid token');
      setTokens((current) => [token, ...current]);
      setSecret(body.secret);
      setName('');
      setExpiresOn('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create developer token');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: SafeToken) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/api-tokens/${token.id}`, {
        method: 'DELETE', headers: dashboardHeaders(),
      });
      if (!response.ok) throw new Error('Could not revoke developer token');
      setTokens((current) => current.map((row) => row.id === token.id
        ? { ...row, revokedAt: new Date().toISOString() }
        : row));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke developer token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="developer-access-heading" className="mx-6 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 id="developer-access-heading" className="font-semibold text-slate-950">Developer API access</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        Read structured issues from <code>/api/v1</code>. These server tokens are separate from the browser widget key.
      </p>
      {secret ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Copy this token now</p>
          <p className="mt-1 text-xs text-amber-900">It is stored only as a hash and cannot be shown again.</p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <input aria-label="One-time developer token" readOnly value={secret} className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs" />
            <CopyButton text={secret} />
            <button type="button" onClick={() => setSecret(null)} className="text-xs font-medium text-amber-900 hover:underline">I saved it</button>
          </div>
        </div>
      ) : null}
      <form onSubmit={create} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="text-xs font-medium text-slate-700">Token name
          <input aria-label="Token name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="CI integration" className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700">Expiry (optional)
          <input aria-label="Token expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Create token</button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-2">
        {tokens.map((token) => (
          <div key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-slate-900">{token.name}</span>
              <span className="break-all font-mono text-xs text-slate-500">{token.tokenPrefix}••••{token.tokenLastFour}</span>
              <span className="text-xs text-slate-500">{token.scope}</span>
            </div>
            {token.revokedAt ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Revoked</span>
            ) : (
              <button type="button" aria-label={`Revoke ${token.name}`} disabled={busy} onClick={() => void revoke(token)} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50">Revoke</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
