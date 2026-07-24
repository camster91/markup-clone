'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import CopyButton from './CopyButton';
import { dashboardHeaders } from '@/lib/client-origin';

type ProjectSettingsProps = {
  projectId: string;
  projectName: string;
  onProjectUpdated: () => void;
  /**
   * Whether the project currently has an active share link. NULL /
   * undefined means "we don't know yet" — the toggle starts in a
   * loading-ish state and queries the server. The task spec has
   * the dashboard poll this from the project list (which carries
   * `shareToken` on ProjectWithPages), so the parent passes the
   * real value once it's loaded.
   */
  hasShareToken?: boolean;
  /**
   * The current share URL, if any. Built by the parent from the
   * project's existing shareToken and the dashboard's origin. The
   * toggle displays this verbatim when set.
   */
  shareUrl?: string | null;
};

export default function ProjectSettings({ projectId, projectName, onProjectUpdated }: ProjectSettingsProps) {
  const [open, setOpen] = useState(false);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRename = async () => {
    setOpen(false);
    const newName = window.prompt('Enter new project name:', projectName);
    if (!newName || newName === projectName) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) onProjectUpdated();
  };

  const handleRegenerateKey = async () => {
    setOpen(false);
    if (!window.confirm('Regenerate the API key? The old key will stop working immediately.')) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({ regenerateKey: true }),
    });
    if (res.ok) {
      const data = await res.json();
      setShowNewKey(data.apiKey ?? null);
      onProjectUpdated();
    }
  };

  const handleDelete = async () => {
    setOpen(false);
    const confirmText = `Delete ${projectName}`;
    if (window.prompt(`Type "${confirmText}" to confirm deletion:`) !== confirmText) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: dashboardHeaders(),
    });
    if (res.ok) onProjectUpdated();
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Settings gear button */}
      <button type="button"
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        aria-label="Project settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50 py-1">
          <button type="button"
            onClick={handleRename}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>

          <button type="button"
            onClick={handleRegenerateKey}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Regenerate API Key
          </button>

          <hr className="my-1 border-gray-200" />

          <button type="button"
            onClick={handleDelete}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Project
          </button>
        </div>
      )}

      {/* New API key display */}
      {showNewKey && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800 mb-1.5">New API key generated — copy it now:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-2 py-1 rounded border border-gray-200 font-mono text-sm">{showNewKey}</code>
            <CopyButton text={showNewKey} />
          </div>
          <button type="button"
            onClick={() => setShowNewKey(null)}
            className="mt-1.5 text-xs text-green-600 hover:text-green-800"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ShareToggle — dashboard control for the project-level public
 * read-only share link.
 *
 * Renders a card with one of two states:
 *   - No share link active: a "Generate share link" button. Clicking
 *     it POSTs to /api/projects/[id]/share, which mints a new
 *     shareToken (rotating any existing one — the previous URL
 *     becomes invalid immediately) and returns { shareToken, shareUrl }.
 *     The toggle then flips to the active state with the new URL
 *     displayed.
 *   - Share link active: the URL in a copy-friendly input, a copy
 *     button, and a "Revoke" button. Revoke DELETEs the shareToken
 *     (sets it to null). The dashboard's poll refreshes the
 *     project list and the toggle returns to the inactive state.
 *
 * The component owns its own loading/error state — `busy` is set
 * during the network roundtrip so the buttons disable and the
 * user can't double-click. `error` renders inline.
 *
 * `onChange` is called after a successful generate or revoke so
 * the parent (DashboardProjects) can refresh the project list to
 * pick up the new shareToken. The dashboard polls every 5s
 * regardless, so this is a fast-path for the user — without it,
 * the toggle would stay stale for up to 5s.
 */
export function ShareToggle({
  projectId,
  hasShareToken,
  shareUrl,
  onChange,
}: {
  projectId: string;
  hasShareToken?: boolean;
  shareUrl?: string | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local copy of the shareUrl — the server tells us the canonical
  // value when we mint, and we display it until the parent re-renders
  // with a new shareUrl from the next poll. Using a local state
  // avoids a flash of the empty state between the POST returning
  // and onChange() triggering a refetch.
  const [activeUrl, setActiveUrl] = useState<string | null>(shareUrl ?? null);

  // Sync the local URL with the prop. If the parent learned about
  // a token from its initial fetch (e.g. the project was created
  // with one in the same session) we should display it. We only
  // reset on prop-change — the activeUrl set by generate should
  // NOT be wiped by a stale null prop before the parent's
  // onProjectUpdated finishes its refetch.
  useEffect(() => {
    if (shareUrl) setActiveUrl(shareUrl);
    else if (hasShareToken === false) setActiveUrl(null);
  }, [shareUrl, hasShareToken]);

  const isActive = hasShareToken === true || (activeUrl !== null && hasShareToken !== false);

  const handleGenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: 'POST',
        headers: dashboardHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generate failed (${res.status})`);
      }
      const data = await res.json();
      // The route returns { shareToken, shareUrl }. We display
      // shareUrl verbatim — it's already an absolute URL built
      // from the request's origin.
      setActiveUrl(data.shareUrl);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm('Revoke the share link? Anyone with the URL will lose access immediately.')) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: 'DELETE',
        headers: dashboardHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Revoke failed (${res.status})`);
      }
      setActiveUrl(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">Public share link</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            isActive
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-200 text-gray-600'
          }`}
        >
          {isActive ? 'Active' : 'Off'}
        </span>
      </div>

      {isActive && activeUrl ? (
        <>
          <div className="flex items-center gap-2">
            <code
              data-testid="share-url"
              className="flex-1 bg-white px-2 py-1 rounded border border-gray-200 font-mono text-xs break-all"
            >
              {activeUrl}
            </code>
            <CopyButton text={activeUrl} />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Anyone with this URL can view the project read-only. Loads are logged to the audit log.
          </p>
          <div className="mt-2 flex justify-end">
            <button type="button"
              onClick={handleRevoke}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Generate a read-only URL to share with clients. They can view the project but cannot leave comments.
          </p>
          <div className="mt-2 flex justify-end">
            <button type="button"
              onClick={handleGenerate}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Generating…' : 'Generate share link'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

/**
 * IntegrationsSection — dashboard control for the per-project
 * outbound notification integrations (Slack, Discord, generic
 * webhook).
 *
 * Renders an inline card with three sub-sections:
 *   - Add new: a kind picker (slack / discord / webhook) plus
 *     a kind-specific config form (webhookUrl for Slack +
 *     Discord, url + optional headers for the generic
 *     webhook).
 *   - List: every existing integration with a "test" button
 *     (fires the /test route) and a "remove" button. Each
 *     row also shows the most recent dispatch outcome —
 *     "last success at X" or "last error: Y" — so the
 *     operator can see at a glance which integrations are
 *     healthy.
 *   - Empty state: a hint + add form.
 *
 * The component owns its own state — `busy` is set during the
 * network roundtrip so the buttons disable and the user can't
 * double-click. The list is re-fetched after every mutation
 * (add / remove / test) so the lastSuccessAt / lastError
 * timestamps stay in sync.
 *
 * The Slack / Discord URL field is `type=password` so the
 * dashboard doesn't leak a webhook URL into a screen-share or
 * a browser history (the URL is the credential — anyone with
 * the URL can post to the channel). The form submits via the
 * dashboard's normal fetch origin (see `dashboardHeaders()`).
 */
export function IntegrationsSection({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Add-form state
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<'slack' | 'discord' | 'webhook'>('slack');
  const [newUrl, setNewUrl] = useState('');
  const [newHeaders, setNewHeaders] = useState('');
  // Per-row test result, keyed by integration id. Cleared
  // when the user starts a new test.
  const [testing, setTesting] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/integrations`, {
        headers: dashboardHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Load failed (${res.status})`);
      }
      const data: IntegrationRow[] = await res.json();
      setRows(data);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    }
  }, [projectId]);

  // Load on mount. Single-shot — re-fetches happen via the
  // mutation handlers (handleAdd / handleRemove / handleTest).
  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAdding(true);
    setError(null);
    try {
      // Build the per-kind config object. The route validates
      // the shape; we just assemble it from the form fields.
      // For `webhook`, the operator can supply a JSON blob of
      // headers ({"X-Auth": "secret"}). Anything non-empty
      // gets parsed; a parse failure is treated as a form
      // validation error rather than a server roundtrip.
      let config: Record<string, unknown> = {};
      if (newKind === 'slack' || newKind === 'discord') {
        config = { webhookUrl: newUrl.trim() };
      } else {
        config = { url: newUrl.trim() };
        if (newHeaders.trim()) {
          try {
            const parsed = JSON.parse(newHeaders.trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              config.headers = parsed;
            } else {
              throw new Error('headers must be a JSON object');
            }
          } catch (parseErr) {
            throw new Error(
              parseErr instanceof Error
                ? `Invalid headers JSON: ${parseErr.message}`
                : 'Invalid headers JSON'
            );
          }
        }
      }
      const res = await fetch(`/api/projects/${projectId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ kind: newKind, config }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Add failed (${res.status})`);
      }
      // Reset the form. We keep `newKind` so the operator
      // can quickly add a second integration of the same kind.
      setNewUrl('');
      setNewHeaders('');
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add integration');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remove this integration? New pins will no longer be sent to it.')) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/integrations/${id}`, {
        method: 'DELETE',
        headers: dashboardHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Remove failed (${res.status})`);
      }
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove integration');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/integrations/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({ integrationId: id }),
      });
      // The test route returns 200 with {ok,lastError?} even
      // on a 5xx from the receiver — the dashboard's "ok"/
      // "error" badge is driven by the JSON body's `ok` field,
      // not the HTTP status.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Test failed (${res.status})`);
      }
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to test integration');
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">Outbound integrations</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
          {rows.length} configured
        </span>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        When a new pin is created, every integration below receives a
        notification. Dispatch is fire-and-forget — a slow or failing
        webhook never delays the pin POST.
      </p>

      {/* Existing integrations list. Each row shows the
          kind + a one-line summary (the URL is masked as
          •••••• so a screen-share doesn't leak the
          credential), the last dispatch outcome, and the
          test/remove buttons. */}
      {loaded && rows.length > 0 && (
        <ul className="space-y-2 mb-3">
          {rows.map((row) => {
            const url = urlForRow(row);
            const status = integrationStatusBadge(row);
            return (
              <li
                key={row.id}
                data-testid={`integration-row-${row.id}`}
                className="bg-white border border-gray-200 rounded px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="inline-block text-xs font-semibold uppercase tracking-wide text-gray-500 flex-shrink-0">
                      {row.kind}
                    </span>
                    {url && (
                      <code
                        data-testid={`integration-url-${row.id}`}
                        className="text-xs font-mono text-gray-400 truncate"
                        title={url}
                      >
                        {maskUrl(url)}
                      </code>
                    )}
                    {status}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTest(row.id)}
                      disabled={testing === row.id || busy}
                      className="text-xs px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testing === row.id ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(row.id)}
                      disabled={busy}
                      className="text-xs px-2 py-0.5 rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {/* Status text — last success or last error.
                    One line, fixed height, so adding a new
                    row doesn't push the list down. */}
                <p className="mt-1 text-xs text-gray-500 truncate">
                  {row.lastError ? (
                    <span data-testid={`integration-error-${row.id}`} className="text-red-600">
                      Last error: {row.lastError}
                    </span>
                  ) : row.lastSuccessAt ? (
                    <span className="text-green-700">
                      Last success:{' '}
                      {new Date(row.lastSuccessAt).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-gray-400 italic">
                      Never tested
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add new integration. The kind picker swaps the
          label/placeholder on the URL field so an operator
          adding a Discord webhook doesn't have to wonder
          which URL is which. The `headers` textarea only
          appears for the generic webhook kind. */}
      <form onSubmit={handleAdd} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600">Kind:</label>
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as 'slack' | 'discord' | 'webhook')}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
            data-testid="integration-kind"
          >
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="webhook">Webhook</option>
          </select>
          <input
            type="password"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={
              newKind === 'webhook'
                ? 'https://example.com/your-webhook'
                : `${newKind} webhook URL`
            }
            className="flex-1 min-w-0 text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
            data-testid="integration-url-input"
          />
        </div>
        {newKind === 'webhook' && (
          <input
            type="text"
            value={newHeaders}
            onChange={(e) => setNewHeaders(e.target.value)}
            placeholder='Optional headers: {"X-Auth": "secret"}'
            className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
            data-testid="integration-headers-input"
          />
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={adding || !newUrl.trim()}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding…' : 'Add integration'}
          </button>
        </div>
      </form>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ----- IntegrationsSection helpers ----------------------------------
//
// The `IntegrationRow` shape mirrors the Prisma `Integration`
// model. We keep a local type rather than importing the
// Prisma-generated type so the dashboard doesn't pull the
// full client into a 200KB+ chunk just to read five fields.
type IntegrationRow = {
  id: string;
  projectId: string;
  kind: string;
  configJson: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
};

/** Pull the destination URL out of a row's configJson. The
 *  shape is kind-specific; this helper centralises the
 *  branching. GET /integrations already redacts secrets in
 *  configJson (scheme+host + short path prefix), so the value
 *  here is display-safe — maskUrl further softens it for the
 *  list row. Returns null when the config doesn't parse —
 *  the row still renders the kind label, just without a URL. */
function urlForRow(row: IntegrationRow): string | null {
  try {
    const config = JSON.parse(row.configJson);
    if (config && typeof config === 'object') {
      if (typeof config.webhookUrl === 'string') return config.webhookUrl;
      if (typeof config.url === 'string') return config.url;
    }
  } catch {
    // Config is malformed — the row was probably created
    // before a schema change. The Test button will surface
    // the real error from the receiver; here we just
    // suppress the URL display.
  }
  return null;
}

/** Mask a URL for display: keep the scheme + host, mask the
 *  path/query. Operators can hover the title attribute to see
 *  the full URL. The point is to keep a screen-share from
 *  leaking the credential in a passing glance. */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/••••••`;
  } catch {
    return '••••••';
  }
}

/** Pick the small status badge (green/red/gray dot) shown
 *  next to the kind label. The full status text is below the
 *  row. */
function integrationStatusBadge(row: IntegrationRow) {
  if (row.lastError) {
    return (
      <span
        title={row.lastError}
        className="inline-block w-2 h-2 rounded-full bg-red-500 flex-shrink-0"
        aria-label="Error"
      />
    );
  }
  if (row.lastSuccessAt) {
    return (
      <span
        title={`Last success at ${row.lastSuccessAt}`}
        className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0"
        aria-label="OK"
      />
    );
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"
      aria-label="Never tested"
    />
  );
}
