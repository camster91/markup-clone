'use client';

// LogoutButton
//
// Trivial button that POSTs to /api/auth/logout and reloads. Kept
// separate from the LoginForm so the dashboard can render them
// independently (the user-info row shows email + this button, the
// logged-out row shows just the LoginForm).

import { useState } from 'react';

export interface LogoutButtonProps {
  /** Optional label override. Default "Sign out". */
  label?: string;
  /** Optional callback fired on success. Default behaviour is
   *  `window.location.reload()` to pick up the cleared session
   *  in the server-rendered parts of the page. */
  onSuccess?: () => void;
}

export default function LogoutButton({ label = 'Sign out', onSuccess }: LogoutButtonProps = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) {
        if (onSuccess) onSuccess();
        else window.location.reload();
        return;
      }
      setError('Logout failed');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-sm bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        {loading ? 'Signing out...' : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
