'use client';

import { useCallback, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';
import type {
  NotificationPreferenceField,
  NotificationPreferenceRole,
  NotificationPreferences,
} from '@/lib/notification-preferences';

type NotificationResponse = {
  saved: boolean;
  role: NotificationPreferenceRole;
  preferences: NotificationPreferences;
  recommended?: NotificationPreferences;
};

const choices: Array<{
  field: NotificationPreferenceField;
  label: string;
  description: string;
  ariaLabel: string;
}> = [
  {
    field: 'newPinEmail',
    label: 'New feedback',
    description: 'A new visual feedback pin is added to this site.',
    ariaLabel: 'Email me about new feedback',
  },
  {
    field: 'newCommentEmail',
    label: 'Thread replies',
    description: 'Someone replies to an existing feedback thread.',
    ariaLabel: 'Email me about thread replies',
  },
  {
    field: 'statusChangeEmail',
    label: 'Status changes',
    description: 'Feedback is resolved or reopened.',
    ariaLabel: 'Email me about status changes',
  },
  {
    field: 'assignmentEmail',
    label: 'Assignments',
    description: 'Feedback is assigned directly to you.',
    ariaLabel: 'Email me when feedback is assigned to me',
  },
  {
    field: 'mentionEmail',
    label: 'Direct mentions',
    description: 'Someone mentions your email in a thread.',
    ariaLabel: 'Email me when I am mentioned',
  },
];

function roleLabel(role: NotificationPreferenceRole): string {
  if (role === 'operator') return 'agency operators';
  if (role === 'owner') return 'agency owners';
  if (role === 'contributor') return 'agency contributors';
  if (role === 'guest') return 'project guests';
  return 'client reviewers';
}

export default function ProjectNotifications({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<NotificationPreferenceRole | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [recommended, setRecommended] = useState<NotificationPreferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/notification-preferences`, {
        headers: dashboardHeaders(),
      });
      if (!response.ok) throw new Error('load failed');
      const data = await response.json() as NotificationResponse;
      setRole(data.role);
      setPreferences(data.preferences);
      setRecommended(data.recommended ?? data.preferences);
      setLoaded(true);
    } catch {
      setError('Could not load email preferences.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    setMessage(null);
    if (next && !loaded && !loading) void load();
  };

  const save = async () => {
    if (!preferences) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/notification-preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify(preferences),
      });
      const data = await response.json().catch(() => ({})) as Partial<NotificationResponse> & { error?: string };
      if (!response.ok || !data.preferences) {
        throw new Error(data.error ?? 'save failed');
      }
      setPreferences(data.preferences);
      setMessage('Email preferences saved.');
    } catch {
      setError('Could not save email preferences. Your previous settings are unchanged.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-t border-gray-100">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls={`notifications-${projectId}`}
        aria-label={`${expanded ? 'Close' : 'Open'} email notification preferences`}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-6 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
      >
        <span>
          <span className="block font-medium text-gray-900">Email notifications</span>
          <span className="block text-xs text-gray-500">Choose which updates reach you for this site.</span>
        </span>
        <span aria-hidden="true" className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {expanded ? (
        <div id={`notifications-${projectId}`} className="px-6 pb-5">
          {loading ? <p role="status" className="py-2 text-sm text-gray-500">Loading email preferences…</p> : null}
          {error ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{error}</p>
              {!loaded ? (
                <button
                  type="button"
                  onClick={() => void load()}
                  aria-label="Retry loading email notification preferences"
                  className="mt-2 min-h-11 rounded-md border border-red-300 bg-white px-3 py-2 font-medium hover:bg-red-100"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {!loading && preferences && role ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 rounded-lg bg-blue-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-blue-950">Recommended for {roleLabel(role)}</p>
                <button
                  type="button"
                  onClick={() => recommended && setPreferences(recommended)}
                  disabled={!recommended || saving}
                  aria-label={`Use recommended settings for ${role}`}
                  className="min-h-11 rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50"
                >
                  Use recommended
                </button>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-gray-900">Updates sent to your account email</legend>
                {choices.map((choice) => (
                  <label key={choice.field} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={preferences[choice.field]}
                      onChange={(event) => setPreferences((current) => current ? {
                        ...current,
                        [choice.field]: event.target.checked,
                      } : current)}
                      aria-label={choice.ariaLabel}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{choice.label}</span>
                      <span className="block text-xs leading-5 text-gray-500">{choice.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  aria-label="Save email notification preferences"
                  className="min-h-11 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save preferences'}
                </button>
                {message ? <p role="status" className="text-sm text-green-700">{message}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
