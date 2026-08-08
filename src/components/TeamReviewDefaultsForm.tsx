'use client';

import { useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

type Props = {
  workspaceId: string;
  teamId: string;
  reviewRoundNameTemplate: string;
  reviewRoundCommentsPaused: boolean;
};

export default function TeamReviewDefaultsForm(props: Props) {
  const [template, setTemplate] = useState(props.reviewRoundNameTemplate);
  const [paused, setPaused] = useState(props.reviewRoundCommentsPaused);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${props.workspaceId}/teams/${props.teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({
          reviewRoundNameTemplate: template.trim(),
          reviewRoundCommentsPaused: paused,
        }),
      });
      const body = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) throw new Error(body.error || 'Could not save review defaults');
      setTemplate(template.trim());
      setMessage('Review defaults saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save review defaults');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-defaults-heading" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 id="review-defaults-heading" className="font-semibold text-gray-900">Review defaults</h2>
      <p className="mt-1 text-sm leading-5 text-gray-600">Reuse this client account's review-round setup across its sites.</p>
      <form onSubmit={save} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Round name template
          <input
            aria-label="Review round name template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            required
            maxLength={120}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <p className="text-xs text-gray-500">Include <code>{'{n}'}</code> where the round number belongs.</p>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            aria-label="Start new rounds paused"
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span>Start new rounds with new feedback paused</span>
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save defaults'}
        </button>
        {message ? <p role="status" className="text-sm text-green-700">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </form>
    </section>
  );
}
