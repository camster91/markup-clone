'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { resolveWorkspaceBranding } from '@/lib/branding';

type InvitationDetails = {
  email: string;
  role: 'owner' | 'contributor' | 'client' | 'guest';
  expiresAt: string;
  workspace: {
    id: string;
    name: string;
    brandName: string | null;
    logoUrl: string | null;
    accentColor: string | null;
    reviewerWelcome: string | null;
  };
  team: { id: string; name: string };
  project: { id: string; name: string } | null;
};

const ROLE_LABELS: Record<InvitationDetails['role'], string> = {
  owner: 'Owner access',
  contributor: 'Contributor access',
  client: 'Client access',
  guest: 'Guest access',
};

export default function InvitationAcceptance() {
  const [token, setToken] = useState<string | null>(null);
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid' | 'accepting' | 'accepted'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState('/');
  const branding = resolveWorkspaceBranding(details?.workspace ?? { name: 'Agency review' });

  useEffect(() => {
    let active = true;
    const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    window.history.replaceState(null, '', '/invite');
    if (!fragment) {
      setStatus('invalid');
      return () => { active = false; };
    }
    setToken(fragment);
    fetch('/api/invitations/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: fragment }),
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<InvitationDetails>;
      })
      .then((body) => {
        if (!active) return;
        setDetails(body);
        setStatus('ready');
      })
      .catch(() => { if (active) setStatus('invalid'); });
    return () => { active = false; };
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setStatus('accepting');
    setError(null);
    const response = await fetch('/api/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error || 'Unable to accept invitation');
      setStatus(response.status === 404 ? 'invalid' : 'ready');
      return;
    }
    const body = await response.json() as { redirectTo: string };
    setToken(null);
    setPassword('');
    setRedirectTo(body.redirectTo);
    setStatus('accepted');
  }

  return (
    <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
      <div className="h-2" style={{ backgroundColor: branding.accentColor }} />
      <div className="p-6 sm:p-8">
      <div className="mb-6">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- validated remote workspace logo
          <img src={branding.logoUrl} alt="" className="mb-4 h-10 max-w-full object-contain object-left" />
        ) : (
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl font-bold" style={{ backgroundColor: branding.accentColor, color: branding.accentText }} aria-hidden="true">
            {branding.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <h1 className="text-2xl font-semibold text-gray-950">Join a review workspace</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">{branding.welcome}</p>
      </div>

      {status === 'loading' ? <p role="status" className="text-sm text-gray-600">Checking your invitation…</p> : null}

      {status === 'invalid' ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">This invitation is unavailable</h2>
          <p className="mt-1 text-sm text-amber-800">It may have expired, been revoked, or already been used. Ask the team owner for a new invitation.</p>
        </div>
      ) : null}

      {(status === 'ready' || status === 'accepting') && details ? (
        <>
          <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Invitation to</p>
            <p className="mt-1 text-lg font-semibold text-gray-950">{details.team.name}</p>
            <p className="text-sm text-gray-600">{branding.displayName}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">{ROLE_LABELS[details.role]}</span>
              {details.project ? <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700">{details.project.name}</span> : null}
            </div>
          </div>

          <form onSubmit={accept} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-800">Invited email</p>
              <p className="mt-1 break-all rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{details.email}</p>
            </div>
            <label className="block text-sm font-medium text-gray-800">
              Password
              <input
                aria-label="Account password" type="password" required minLength={12} maxLength={128}
                autoComplete="current-password" value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-950"
              />
              <span className="mt-1 block text-xs leading-5 text-gray-500">If you already have an account, enter its password. Otherwise, this creates your account. Use at least 12 characters with letters and numbers.</span>
            </label>
            {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
            <button type="submit" disabled={status === 'accepting'} className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: branding.accentColor, color: branding.accentText }}>
              {status === 'accepting' ? 'Joining…' : 'Accept invitation'}
            </button>
          </form>
        </>
      ) : null}

      {status === 'accepted' ? (
        <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4">
          <h2 className="font-semibold text-green-950">Invitation accepted</h2>
          <p className="mt-1 text-sm text-green-800">Your access is ready.</p>
          <a href={redirectTo} className="mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-semibold" style={{ backgroundColor: branding.accentColor, color: branding.accentText }}>Continue to the workspace</a>
        </div>
      ) : null}
      </div>
    </div>
  );
}
