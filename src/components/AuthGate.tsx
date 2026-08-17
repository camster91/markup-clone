'use client';

// AuthGate
//
// Fetches /api/auth/me on mount and renders either the LoginForm
// (no session) or the user-info row (session present). Used at the
// top of the dashboard.
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

import { useEffect, useState } from 'react';
import LoginForm from './LoginForm';
import LogoutButton from './LogoutButton';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export type AuthState = 'loading' | 'anonymous' | 'authenticated';

export interface AuthGateProps {
  /** Optional callback when the auth state resolves. */
  onChange?: (state: AuthState, user: AuthUser | null) => void;
  /** Validated same-origin destination restored after login. */
  returnTo?: string | null;
}

export default function AuthGate({ onChange, returnTo }: AuthGateProps = {}) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

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
        setState('anonymous');
        onChange?.('anonymous', null);
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

  if (state === 'anonymous') {
    return <LoginForm returnTo={returnTo} />;
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
