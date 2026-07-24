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

import { useCallback, useEffect, useState } from 'react';
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

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const u: AuthUser = data.user;
        setUser(u);
        setState('authenticated');
        onChange?.('authenticated', u);
      } else {
        // HTTP error from the auth endpoint → treat as logged out
        // (show the login form). A 401/403 is "anonymous"; a 5xx is
        // also anonymous so the operator can still attempt login.
        setUser(null);
        setState('anonymous');
        onChange?.('anonymous', null);
      }
    } catch {
      // Network failure (offline / DNS / abort) → offline banner,
      // NOT the login form. Retry re-fetches /api/auth/me.
      setUser(null);
      setState('offline');
      onChange?.('offline', null);
    }
    // onChange is intentionally not a dep — it's a callback
    // and including it would re-fetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const u: AuthUser = data.user;
          setUser(u);
          setState('authenticated');
          onChange?.('authenticated', u);
        } else {
          setUser(null);
          setState('anonymous');
          onChange?.('anonymous', null);
        }
      } catch {
        if (cancelled) return;
        setUser(null);
        setState('offline');
        onChange?.('offline', null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onChange is intentionally not a dep — it's a callback
    // and including it would re-fetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        className="mb-8 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-3"
        role="status"
      >
        <span>Unable to reach the server — check your connection.</span>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            void checkAuth();
          }}
          className="text-sm font-medium text-amber-900 underline hover:no-underline"
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
