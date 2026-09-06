'use client';

// LoginForm
//
// Client component for the dashboard's per-user login flow. Rendered
// at the top of the dashboard when /api/auth/me returns 401. Once a
// valid session is established, the parent swaps the form for a
// "logged in as <email> · logout" widget — the form's job is only
// the entry path.
//
// Behaviour:
//   - POSTs { email, password } to /api/auth/login on submit
//   - On 200, reloads the window so server-rendered dashboard data
//     picks up the new session (cookie is set; subsequent /api/auth/me
//     returns 200; the parent re-renders with user info)
//   - On 401, surfaces the "invalid email or password" error inline
//   - On any other error, surfaces the server message
//
// The form intentionally does NOT set the session in JS — the cookie
// comes from the server's Set-Cookie header. JS never sees the token,
// so an XSS bug on the dashboard cannot exfiltrate the session.

import { useState } from 'react';

export interface LoginFormProps {
  /** Optional callback fired on a successful login. The parent uses
   *  this to swap the form for the user-info widget without a full
   *  page reload — `window.location.reload()` is the default
   *  fallback used when this prop is absent. */
  onSuccess?: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        // The login route does not require the dashboard origin
        // (it's the entry point), so we don't attach one. The
        // cookie it returns is HttpOnly + SameSite=Strict, so a
        // cross-site POST can't read it.
        credentials: 'same-origin',
      });
      if (res.ok) {
        if (onSuccess) onSuccess();
        else window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || `Login failed (${res.status})`);
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8"
      aria-label="Sign in to the dashboard"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Sign in</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="username"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mt-2"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="mt-4 min-h-11 bg-blue-600 text-white px-4 py-2 rounded-lg text-base sm:text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
