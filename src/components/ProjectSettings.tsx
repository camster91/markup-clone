'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import CopyButton from './CopyButton';
import { dashboardHeaders } from '@/lib/client-origin';
import { formatDateTime } from '@/lib/date-format';

type ProjectSettingsProps = {
  projectId: string;
  projectName: string;
  archivedAt?: string | null;
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

export default function ProjectSettings({ projectId, projectName, archivedAt, onProjectUpdated }: ProjectSettingsProps) {
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

  const handleArchiveChange = async () => {
    setOpen(false);
    const nextArchived = !archivedAt;
    if (nextArchived && !window.confirm(`Archive ${projectName}? It will stop accepting new feedback.`)) return;

    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({ archived: nextArchived }),
    });
    if (res.ok) onProjectUpdated();
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Settings gear button */}
      <button type="button"
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        aria-label="Site settings"
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
            onClick={handleArchiveChange}
            className="w-full text-left px-4 py-2 text-sm text-amber-800 hover:bg-amber-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {archivedAt ? 'Restore site' : 'Archive site'}
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
export function buildShareRequestBody(expiresLocal: string, password: string) {
  return {
    expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null,
    password: password || null,
  };
}

export function ShareToggle({
  projectId,
  hasShareToken,
  shareUrl,
  shareExpiresAt,
  sharePasswordProtected,
  onChange,
}: {
  projectId: string;
  hasShareToken?: boolean;
  shareUrl?: string | null;
  shareExpiresAt?: string | null;
  sharePasswordProtected?: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(shareUrl ?? null);
  const [activeExpiry, setActiveExpiry] = useState<string | null>(shareExpiresAt ?? null);
  const [activePasswordProtected, setActivePasswordProtected] = useState(
    sharePasswordProtected ?? false
  );
  const [configuring, setConfiguring] = useState(hasShareToken !== true);
  const [expiresLocal, setExpiresLocal] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (shareUrl) {
      setActiveUrl(new URL(shareUrl, window.location.origin).toString());
    } else if (hasShareToken === false) {
      setActiveUrl(null);
    }
  }, [shareUrl, hasShareToken]);

  useEffect(() => {
    setActiveExpiry(shareExpiresAt ?? null);
    setActivePasswordProtected(sharePasswordProtected ?? false);
  }, [shareExpiresAt, sharePasswordProtected]);

  const isActive = hasShareToken === true || (activeUrl !== null && hasShareToken !== false);

  const handleGenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify(buildShareRequestBody(expiresLocal, password)),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generate failed (${res.status})`);
      }
      const data = await res.json();
      setActiveUrl(data.shareUrl);
      setActiveExpiry(data.expiresAt ?? null);
      setActivePasswordProtected(data.passwordProtected === true);
      setPassword('');
      setConfiguring(false);
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
      setActiveExpiry(null);
      setActivePasswordProtected(false);
      setConfiguring(true);
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
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
        }`}>
          {isActive ? 'Active' : 'Off'}
        </span>
      </div>

      {isActive && activeUrl && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code
              data-testid="share-url"
              className="min-w-0 flex-1 bg-white px-2 py-1 rounded border border-gray-200 font-mono text-xs break-all"
            >
              {activeUrl}
            </code>
            <CopyButton text={activeUrl} />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Open access is stored in a secure browser cookie. Loads are logged to the audit log.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-700">
            <span className="rounded-full bg-white px-2 py-1 border border-gray-200">
              {activePasswordProtected ? 'Password protected' : 'No password'}
            </span>
            <span className="rounded-full bg-white px-2 py-1 border border-gray-200">
              {activeExpiry ? `Expires ${formatDateTime(activeExpiry)}` : 'No expiry'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfiguring((value) => !value)}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {configuring ? 'Cancel replacement' : 'Replace link'}
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        </>
      )}

      {(!isActive || configuring) && (
        <div className={isActive ? 'mt-4 border-t border-gray-200 pt-4' : ''}>
          <p className="text-xs text-gray-500">
            {isActive
              ? 'Replacing rotates the URL immediately. Enter controls for the replacement link.'
              : 'Generate a read-only client URL. Expiry and password are optional.'}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`share-expiry-${projectId}`} className="block text-xs font-medium text-gray-700">
                Share link expiry
              </label>
              <input
                id={`share-expiry-${projectId}`}
                type="datetime-local"
                value={expiresLocal}
                onChange={(event) => setExpiresLocal(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
              />
              <p className="mt-1 text-xs text-gray-500">Up to 365 days from now.</p>
            </div>
            <div>
              <label htmlFor={`share-password-${projectId}`} className="block text-xs font-medium text-gray-700">
                Share link password
              </label>
              <input
                id={`share-password-${projectId}`}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
              />
              <p className="mt-1 text-xs text-gray-500">Optional; 8 characters minimum.</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy || (password.length > 0 && password.length < 8)}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Generating…' : isActive ? 'Replace share link' : 'Generate share link'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
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
  const [deliveries, setDeliveries] = useState<IntegrationDeliveryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deliveriesLoaded, setDeliveriesLoaded] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [newSigningSecret, setNewSigningSecret] = useState<string | null>(null);
  // Add-form state
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<'slack' | 'discord' | 'webhook' | 'github'>('slack');
  const [newUrl, setNewUrl] = useState('');
  const [newHeaders, setNewHeaders] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubLabels, setGithubLabels] = useState('visual-feedback');
  const [githubToken, setGithubToken] = useState('');
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

  const fetchDeliveries = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/integrations/deliveries`, {
        headers: dashboardHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delivery log failed (${res.status})`);
      }
      const body: unknown = await res.json();
      setDeliveries(Array.isArray(body)
        ? body.filter(isIntegrationDeliveryRow)
        : []);
      setDeliveriesLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load delivery activity');
    }
  }, [projectId]);

  // Load on mount. Single-shot — re-fetches happen via the
  // mutation handlers (handleAdd / handleRemove / handleTest).
  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newKind === 'github') {
      if (!githubOwner.trim() || !githubRepo.trim() || !githubToken) return;
    } else if (!newUrl.trim()) return;
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
      if (newKind === 'github') {
        config = {
          owner: githubOwner.trim(),
          repo: githubRepo.trim(),
          labels: githubLabels.split(',').map((label) => label.trim()).filter(Boolean),
          token: githubToken,
        };
      } else if (newKind === 'slack' || newKind === 'discord') {
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
      const created = await res.json() as { signingSecret?: string };
      if (newKind === 'webhook' && created.signingSecret) {
        setNewSigningSecret(created.signingSecret);
      }
      // Reset the form. We keep `newKind` so the operator
      // can quickly add a second integration of the same kind.
      setNewUrl('');
      setNewHeaders('');
      setGithubOwner('');
      setGithubRepo('');
      setGithubLabels('visual-feedback');
      setGithubToken('');
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add integration');
    } finally {
      setAdding(false);
    }
  };

  const handleRetry = async (deliveryId: string) => {
    setRetrying(deliveryId);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/integrations/deliveries/${deliveryId}/retry`,
        { method: 'POST', headers: dashboardHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Retry failed (${res.status})`);
      }
      await fetchDeliveries();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry delivery');
    } finally {
      setRetrying(null);
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
        durable notification. Failed deliveries retry automatically and remain
        visible here without delaying client feedback.
      </p>

      {newSigningSecret && (
        <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-semibold">Copy this signing secret now</p>
          <p className="mt-0.5">It will not be shown again. Use it to verify webhook signatures.</p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-white px-2 py-1 font-mono">
              {newSigningSecret}
            </code>
            <CopyButton text={newSigningSecret} />
            <button
              type="button"
              onClick={() => setNewSigningSecret(null)}
              className="rounded px-2 py-1 text-amber-800 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Existing integrations list. Each row shows the
          kind + a one-line summary (the URL is masked as
          •••••• so a screen-share doesn't leak the
          credential), the last dispatch outcome, and the
          test/remove buttons. */}
      {loaded && rows.length > 0 && (
        <ul className="space-y-2 mb-3">
          {rows.map((row) => {
            const destination = destinationForRow(row);
            const status = integrationStatusBadge(row);
            return (
              <li
                key={row.id}
                data-testid={`integration-row-${row.id}`}
                className="bg-white border border-gray-200 rounded px-3 py-2"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="inline-block text-xs font-semibold uppercase tracking-wide text-gray-500 flex-shrink-0">
                      {row.kind}
                    </span>
                    {destination && (
                      <code
                        data-testid={`integration-url-${row.id}`}
                        className={`text-xs font-mono text-gray-400 ${
                          destination.secret ? 'truncate' : 'break-all whitespace-normal'
                        }`}
                        title={destination.value}
                      >
                        {destination.secret ? maskUrl(destination.value) : destination.value}
                      </code>
                    )}
                    {status}
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-auto flex-shrink-0">
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
          <label htmlFor="integration-kind" className="text-xs text-gray-600">Kind:</label>
          <select
            id="integration-kind"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as 'slack' | 'discord' | 'webhook' | 'github')}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
            data-testid="integration-kind"
          >
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="webhook">Webhook</option>
            <option value="github">GitHub issue</option>
          </select>
        </div>
        {newKind === 'github' ? (
          <fieldset className="grid gap-2 rounded border border-gray-200 bg-white p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium text-gray-700">GitHub repository</legend>
            <input
              type="text"
              aria-label="GitHub owner"
              value={githubOwner}
              onChange={(event) => setGithubOwner(event.target.value)}
              placeholder="Organization or owner"
              autoComplete="off"
              className="min-w-0 rounded border border-gray-200 px-2 py-1 text-xs font-mono"
            />
            <input
              type="text"
              aria-label="GitHub repository"
              value={githubRepo}
              onChange={(event) => setGithubRepo(event.target.value)}
              placeholder="Repository name"
              autoComplete="off"
              className="min-w-0 rounded border border-gray-200 px-2 py-1 text-xs font-mono"
            />
            <input
              type="text"
              aria-label="GitHub labels"
              value={githubLabels}
              onChange={(event) => setGithubLabels(event.target.value)}
              placeholder="Labels, comma separated"
              className="min-w-0 rounded border border-gray-200 px-2 py-1 text-xs font-mono"
            />
            <input
              type="password"
              aria-label="GitHub token"
              value={githubToken}
              onChange={(event) => setGithubToken(event.target.value)}
              placeholder="Fine-grained access token"
              autoComplete="new-password"
              className="min-w-0 rounded border border-gray-200 px-2 py-1 text-xs font-mono"
            />
            <p className="text-xs text-gray-500 sm:col-span-2">
              Restrict the token to this repository with Metadata: read and Issues: write.
              The token is encrypted before storage and is never shown again.
            </p>
          </fieldset>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            aria-label="Integration URL"
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
        )}
        {newKind === 'webhook' && (
          <input
            type="text"
            aria-label="Optional webhook headers as JSON"
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
            disabled={adding || (newKind === 'github'
              ? !githubOwner.trim() || !githubRepo.trim() || !githubToken
              : !newUrl.trim())}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding…' : 'Add integration'}
          </button>
        </div>
      </form>

      <div className="mt-4 border-t border-gray-200 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-700">Delivery activity</h3>
          <button
            type="button"
            onClick={() => {
              setActivityOpen(true);
              void fetchDeliveries();
            }}
            className="rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
          >
            {activityOpen ? 'Refresh' : 'Show activity'}
          </button>
        </div>
        {!activityOpen ? (
          <p className="text-xs text-gray-400">Open the delivery log to inspect retries and failures.</p>
        ) : !deliveriesLoaded ? (
          <p className="text-xs text-gray-400">Loading delivery activity…</p>
        ) : deliveries.length === 0 ? (
          <p className="text-xs text-gray-400">No deliveries yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Integration delivery activity">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="rounded border border-gray-200 bg-white px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold uppercase text-gray-600">{delivery.integration.kind}</span>
                    <span className={deliveryStatusClass(delivery.status)}>
                      {deliveryStatusLabel(delivery.status)}
                    </span>
                    <span className="text-gray-400">
                      Attempt {delivery.attemptCount}/5
                      {delivery.retryCycle > 0 ? ` · retry cycle ${delivery.retryCycle + 1}` : ''}
                    </span>
                  </div>
                  {delivery.status === 'DEAD_LETTER' && (
                    <button
                      type="button"
                      onClick={() => handleRetry(delivery.id)}
                      disabled={retrying === delivery.id}
                      className="rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      {retrying === delivery.id ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-gray-500">
                  {delivery.event.type} · {new Date(delivery.event.occurredAt).toLocaleString()}
                </p>
                {delivery.externalUrl && delivery.externalId && (
                  <a
                    href={delivery.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                  >
                    Open GitHub issue
                    <span className="sr-only"> #{delivery.externalId} (opens in a new tab)</span>
                  </a>
                )}
                {delivery.lastError && (
                  <p className="mt-1 break-words text-red-700">{delivery.lastError}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

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
  credentialConfigured?: boolean;
};

type IntegrationDeliveryRow = {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'RETRY_SCHEDULED' | 'SUCCEEDED' | 'DEAD_LETTER';
  attemptCount: number;
  retryCycle: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  externalId: string | null;
  externalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  integration: { id: string; kind: string };
  event: { id: string; type: string; occurredAt: string };
};

function isIntegrationDeliveryRow(value: unknown): value is IntegrationDeliveryRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<IntegrationDeliveryRow>;
  return typeof row.id === 'string'
    && typeof row.status === 'string'
    && typeof row.attemptCount === 'number'
    && typeof row.retryCycle === 'number'
    && Boolean(row.integration && typeof row.integration.kind === 'string')
    && Boolean(row.event && typeof row.event.type === 'string' && typeof row.event.occurredAt === 'string');
}

function deliveryStatusLabel(status: IntegrationDeliveryRow['status']): string {
  switch (status) {
    case 'PENDING': return 'Pending';
    case 'PROCESSING': return 'Sending';
    case 'RETRY_SCHEDULED': return 'Retry scheduled';
    case 'SUCCEEDED': return 'Delivered';
    case 'DEAD_LETTER': return 'Dead letter';
  }
}

function deliveryStatusClass(status: IntegrationDeliveryRow['status']): string {
  const base = 'rounded-full px-2 py-0.5 font-medium';
  if (status === 'SUCCEEDED') return `${base} bg-green-100 text-green-800`;
  if (status === 'DEAD_LETTER') return `${base} bg-red-100 text-red-800`;
  if (status === 'RETRY_SCHEDULED') return `${base} bg-amber-100 text-amber-800`;
  return `${base} bg-gray-100 text-gray-700`;
}

/** Pull a safe destination label out of a row's configJson. The
 *  shape is kind-specific; this helper centralises the
 *  branching. Returns null when the config doesn't parse —
 *  the row still renders the kind label, just without a URL. */
function destinationForRow(row: IntegrationRow): { value: string; secret: boolean } | null {
  try {
    const config = JSON.parse(row.configJson);
    if (config && typeof config === 'object') {
      if (row.kind === 'github' && typeof config.owner === 'string' && typeof config.repo === 'string') {
        return { value: `${config.owner}/${config.repo}`, secret: false };
      }
      if (typeof config.webhookUrl === 'string') return { value: config.webhookUrl, secret: true };
      if (typeof config.url === 'string') return { value: config.url, secret: true };
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
