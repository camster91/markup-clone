'use client';

// AuthGate
//
// Fetches /api/auth/me on mount and renders either the LoginForm
// (no session), an offline banner (network failure), or the user-info
// row (session present). Used at the top of the dashboard.
//
// Why client-side and not server-rendered:
//   - The dashboard page is server-rendered for the project data
//     (force-dynamic), but reading the session cookie in a Server
//     Component requires awaiting cookies() — and in Next.js 15+
//     cookies() in a Server Component is fine, but mixing it with
//     the page's existing prisma queries meant duplicating the
//     auth-lookup pattern in every page. Keeping the user-info
//     rendering in a client island keeps the rest of the page
//     unchanged and matches the dashboard's existing
//     "client component reads state, server component fetches
//     data" pattern.
//   - The fetches are tiny and cached by the browser; the first
//     paint is "loading" for a frame, which is fine for the
//     dashboard (it's not a content-critical path).
//
// `onChange` is fired whenever the auth state flips, so the
// parent can re-render related state (e.g. a header avatar).
//
// Offline vs anonymous:
//   - Network failure (fetch throw) → 'offline' + Retry; do NOT show
//     LoginForm (that would imply the session is missing).
//   - HTTP !ok (401/403/…) → 'anonymous' + LoginForm.

import { useCallback, useEffect, useRef, useState } from 'react';
import LoginForm from './LoginForm';
import LogoutButton from './LogoutButton';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export type AuthState = 'loading' | 'anonymous' | 'authenticated' | 'offline';

export interface AuthGateProps {
  /** Optional callback when the auth state resolves. */
  onChange?: (state: AuthState, user: AuthUser | null) => void;
}

export default function AuthGate({ onChange }: AuthGateProps = {}) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const checkSession = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (signal?.cancelled) return;
      if (res.ok) {
        const data = await res.json();
        const u: AuthUser = data.user;
        setUser(u);
        setState('authenticated');
        onChangeRef.current?.('authenticated', u);
      } else {
        setUser(null);
        setState('anonymous');
        onChangeRef.current?.('anonymous', null);
      }
    } catch {
      if (signal?.cancelled) return;
      setUser(null);
      setState('offline');
      onChangeRef.current?.('offline', null);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void checkSession(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [checkSession]);

  if (state === 'loading') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8 text-sm text-gray-400">
        Checking session...
      </div>
    );
  }

  if (state === 'offline') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-8 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <span>Can&apos;t reach the server. Check your connection.</span>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            void checkSession();
          }}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state === 'anonymous') {
    return <LoginForm onSuccess={() => window.location.reload()} />;
  }

  // authenticated
  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8 flex items-center justify-between flex-wrap gap-4"
      aria-label="Signed in"
    >
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Signed in</h2>
        <p className="text-sm text-gray-500 mt-1">
          {user?.email}{' '}
          <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">
            {user?.role}
          </span>
        </p>
      </div>
      <LogoutButton onSuccess={() => window.location.reload()} />
    </div>
  );
}
