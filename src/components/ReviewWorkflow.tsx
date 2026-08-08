'use client';

import { useCallback, useEffect, useState } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

type SignOff = {
  id: string;
  userId: string | null;
  signerEmail: string;
  note: string | null;
  createdAt: string;
};

type ReviewRound = {
  id: string;
  number: number;
  name: string | null;
  status: string;
  commentsPaused: boolean;
  isActive: boolean;
  pinCount: number;
  signOffs: SignOff[];
  createdAt: string;
  updatedAt: string;
};

type ReviewWorkflowData = {
  activeReviewRoundId: string | null;
  canAdmin: boolean;
  callerUserId: string;
  defaults?: { suggestedName: string; commentsPaused: boolean };
  rounds: ReviewRound[];
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  ARCHIVED: 'Archived',
};

const STATUS_OPTIONS: Record<string, string[]> = {
  DRAFT: ['DRAFT', 'IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'ARCHIVED'],
  CHANGES_REQUESTED: ['CHANGES_REQUESTED', 'IN_REVIEW', 'APPROVED', 'ARCHIVED'],
  APPROVED: ['APPROVED', 'CHANGES_REQUESTED', 'ARCHIVED'],
  ARCHIVED: ['ARCHIVED'],
};

export default function ReviewWorkflow({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ReviewWorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roundName, setRoundName] = useState('');
  const [note, setNote] = useState('');

  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/review-rounds`;
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { headers: dashboardHeaders() });
      if (!response.ok) throw new Error('Unable to load the review workflow');
      const next = await response.json() as ReviewWorkflowData;
      if (!Array.isArray(next.rounds)) throw new Error('Invalid review workflow response');
      setData(next);
      if (next.canAdmin && next.defaults?.suggestedName) {
        setRoundName((current) => current || next.defaults!.suggestedName);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the review workflow');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Unable to update the review workflow');
      }
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the review workflow');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const activeRound = data?.rounds.find((round) => round.isActive) ?? null;
  const ownSignOff = activeRound?.signOffs.find((signOff) => signOff.userId === data?.callerUserId) ?? null;

  const createRound = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await mutate(endpoint, 'POST', { name: roundName })) setRoundName('');
  };

  const updateRound = (round: ReviewRound, changes: { status?: string; commentsPaused?: boolean }) =>
    mutate(`${endpoint}/${encodeURIComponent(round.id)}`, 'PATCH', changes);

  const saveSignOff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRound) return;
    if (await mutate(`${endpoint}/${encodeURIComponent(activeRound.id)}/sign-offs`, 'POST', { note })) setNote('');
  };

  return (
    <section aria-labelledby={`review-workflow-${projectId}`} className="border-t border-gray-200 bg-blue-50/40 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`review-workflow-${projectId}`} className="text-base font-semibold text-gray-900">Review workflow</h3>
          <p className="mt-1 text-sm text-gray-600">Keep client approvals and feedback cycles attached to this site.</p>
        </div>
        {activeRound ? (
          <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-800">
            {STATUS_LABELS[activeRound.status] ?? activeRound.status}
          </span>
        ) : null}
      </div>

      {loading && !data ? <p role="status" aria-live="polite" className="mt-4 text-sm text-gray-500">Loading review workflow...</p> : null}
      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded border border-red-300 bg-white px-3 py-1 font-medium">Retry</button>
        </div>
      ) : null}

      {!loading && data && !activeRound ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-4">
          <p className="text-sm font-medium text-gray-800">No active review round</p>
          <p className="mt-1 text-sm text-gray-600">Feedback can continue, but it will remain outside a named approval cycle.</p>
          {data.canAdmin ? (
            <form onSubmit={createRound} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor={`round-name-${projectId}`}>Review round name</label>
              <input id={`round-name-${projectId}`} name="roundName" value={roundName} onChange={(event) => setRoundName(event.target.value)} maxLength={120} placeholder="e.g. Homepage launch" className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
              <button type="submit" disabled={busy} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Start first review round</button>
            </form>
          ) : null}
          {data.canAdmin && data.defaults?.commentsPaused ? (
            <p className="mt-2 text-xs text-amber-800">New rounds start with new feedback paused for this client account.</p>
          ) : null}
        </div>
      ) : null}

      {activeRound && data ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-gray-900">Round {activeRound.number}{activeRound.name ? ` - ${activeRound.name}` : ''}</p>
              <p className="mt-1 text-sm text-gray-600">{activeRound.pinCount} feedback {activeRound.pinCount === 1 ? 'item' : 'items'} · {activeRound.signOffs.length} {activeRound.signOffs.length === 1 ? 'sign-off' : 'sign-offs'}</p>
            </div>
            {data.canAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`round-status-${activeRound.id}`}>Review status</label>
                <select id={`round-status-${activeRound.id}`} value={activeRound.status} disabled={busy} onChange={(event) => void updateRound(activeRound, { status: event.target.value })} className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm">
                  {(STATUS_OPTIONS[activeRound.status] ?? [activeRound.status]).map((status) => <option key={status} value={status}>{STATUS_LABELS[status] ?? status}</option>)}
                </select>
                <button type="button" disabled={busy} onClick={() => void updateRound(activeRound, { commentsPaused: !activeRound.commentsPaused })} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 disabled:opacity-50">
                  {activeRound.commentsPaused ? 'Resume new feedback' : 'Pause new feedback'}
                </button>
              </div>
            ) : null}
          </div>

          {activeRound.commentsPaused ? <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">New pins are paused; replies remain open.</p> : null}

          <div className="mt-4 border-t border-gray-100 pt-4">
            {ownSignOff ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-green-800">You signed off{ownSignOff.note ? `: ${ownSignOff.note}` : '.'}</span>
                <button type="button" disabled={busy} onClick={() => void mutate(`${endpoint}/${encodeURIComponent(activeRound.id)}/sign-offs/${encodeURIComponent(ownSignOff.id)}`, 'DELETE')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50">Withdraw sign-off</button>
              </div>
            ) : (
              <form onSubmit={saveSignOff} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`signoff-note-${activeRound.id}`} className="block text-sm font-medium text-gray-700">Optional approval note</label>
                  <input id={`signoff-note-${activeRound.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Ready to proceed" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <button type="submit" disabled={busy} className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Sign off</button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {data && data.rounds.length > 1 ? (
        <details className="mt-3 text-sm text-gray-700">
          <summary className="cursor-pointer font-medium">Past review rounds ({data.rounds.length - 1})</summary>
          <ul className="mt-2 space-y-1 pl-5">
            {data.rounds.filter((round) => !round.isActive).map((round) => <li key={round.id}>Round {round.number}{round.name ? ` - ${round.name}` : ''}: {STATUS_LABELS[round.status] ?? round.status}</li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
