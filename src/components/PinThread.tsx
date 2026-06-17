'use client';

import { useState } from 'react';
import type { FeedbackComment } from '@/lib/types';
import { useLiveEvents } from '@/lib/hooks/useLiveEvents';
import { MENTION_RE } from '@/lib/mentions';

type Pin = { id: string; xPercent: number; yPercent: number; status: string; elementXPath?: string | null; elementHTML?: string | null; createdAt: string; comments: FeedbackComment[] };

/**
 * Render a comment string as a list of React nodes, wrapping every
 * `@<email>` mention in a styled <span>. Pure: takes a string, returns
 * a node list — no hooks, no side effects, safe to call inline inside
 * the render. The split is done on a fresh, /g regex copy so the
 * module-level regex's `lastIndex` is never mutated by the renderer.
 *
 * Plain (non-mention) text is rendered as a single text node to avoid
 * one React child per character, which would balloon the diff tree
 * for a 2000-char comment.
 */
function renderCommentText(text: string): React.ReactNode[] {
  const re = new RegExp(MENTION_RE.source, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(
      <span
        key={`m-${key++}`}
        className="font-medium text-blue-700 bg-blue-50 rounded px-0.5"
        title={`Mentioned: ${m[1]}`}
      >
        {m[0]}
      </span>
    );
    lastIndex = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export default function PinThread({
  pin,
  projectId,
  readOnly = false,
  onClose,
  onStatusChange,
  onCommentAdded,
}: {
  pin: Pin;
  /**
   * The project this pin belongs to. Used to scope the SSE subscription
   * so a new-comment event for THIS pin triggers an optimistic append.
   * Optional — when omitted (e.g. a unit test renders the thread in
   * isolation), the SSE hook short-circuits and the thread falls back to
   * the props-driven comment list (the ScreenshotView's own useLiveEvents
   * call is the primary update path).
   */
  projectId?: string | null;
  /**
   * Hide the reply form and the open/resolved toggle. Used by the
   * public /share/[token] view. Existing comments are still rendered
   * read-only so a share-link viewer can follow the conversation
   * history — they just can't add to it.
   */
  readOnly?: boolean;
  onClose: () => void;
  onStatusChange: (pinId: string, status: 'OPEN' | 'RESOLVED') => Promise<void>;
  onCommentAdded: (pinId: string, comment: FeedbackComment) => void;
}) {
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [author, setAuthor] = useState('Reviewer');

  // === Live updates (SSE) =================================================
  // Subscribe to the project SSE stream and optimistically append any
  // new-comment event whose pinId matches the pin we're rendering.
  // The dispatch goes through onCommentAdded (the same callback the
  // POST handler uses) so the parent ScreenshotView owns the source
  // of truth for the comment list. The ScreenshotView's own
  // useLiveEvents also subscribes, so this is "belt and suspenders"
  // — both layers dedupe on comment id, and a slow SSE event
  // combined with a slow POST roundtrip can never double-append.
  //
  // Note: we filter on `pin.id` here, NOT on the screenshot id,
  // because the route's emit() carries the pinId, not the
  // screenshotId, in the payload. Multiple PinThread instances can
  // be open (one per pin) but only the one whose `pin.id` matches
  // the event will fire onCommentAdded.
  useLiveEvents({
    projectId: projectId ?? null,
    onEvent: (event) => {
      if (event.type === 'new-comment') {
        const payload = event.payload as {
          pinId: string;
          comment: FeedbackComment;
        };
        if (payload.pinId === pin.id && payload.comment && payload.comment.id) {
          // Skip if the comment is already in the local list (a
          // slow POST + slow SSE race). The ScreenshotView's
          // setPins dedupes the same way, so a duplicate never
          // reaches the user.
          if (pin.comments.some(c => c.id === payload.comment.id)) return;
          onCommentAdded(pin.id, payload.comment);
        }
      }
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Defense in depth: the form is hidden when readOnly, but if a
    // future change re-renders it the post must still no-op so a
    // share-link viewer can't fake a comment.
    if (readOnly) return;
    if (!reply.trim() || submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/pins/${pin.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: reply, author, authorRole: 'reviewer' }),
    });
    if (res.ok) {
      const data = await res.json();
      onCommentAdded(pin.id, data.data);
      setReply('');
    }
    setSubmitting(false);
  };

  const toggleStatus = () => {
    if (readOnly) return;
    const next = pin.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    onStatusChange(pin.id, next);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${pin.status === 'OPEN' ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className="text-xs font-medium text-gray-500">
            {pin.status === 'OPEN' ? 'Open' : 'Resolved'}
          </span>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="space-y-3 mb-4">
        {pin.comments.map((c) => (
          <div
            key={c.id}
            className={`p-2 rounded text-sm ${
              c.authorRole === 'client'
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-blue-50 border border-blue-200'
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-medium text-gray-700">{c.author}</span>
              <span className="ml-1">({c.authorRole})</span>
              <span className="ml-2">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            {/* Highlight @mentions. The split uses the same regex as
                the server-side parseMentions so what the recipient
                sees in the email body matches what's highlighted in
                the UI. Splitting on the full match (including the @)
                keeps the original characters in the output, so screen
                readers still read "@alice@example.com" as text. */}
            <div className="text-gray-800 whitespace-pre-wrap">
              {renderCommentText(c.text)}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {/* The reply form is dashboard-only. The /share/[token] view
            shows the conversation history but does not let a
            share-link viewer add to it. Hiding the whole form (not
            just disabling it) is what the task asks for — the
            "read-only" UX should look read-only, not "muted and
            half-broken". */}
        {!readOnly && (
          <>
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          placeholder="Reply..."
          className="w-full border border-gray-300 rounded p-2 text-sm resize-none"
          rows={2}
        />
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Your name"
            className="border border-gray-300 rounded px-2 py-1 text-xs w-24"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={toggleStatus}
              className={`text-xs px-2 py-1 rounded ${
                pin.status === 'OPEN'
                  ? 'bg-green-100 text-green-800 hover:bg-green-200'
                  : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
              }`}
            >
              {pin.status === 'OPEN' ? 'Mark resolved' : 'Reopen'}
            </button>
            <button
              type="submit"
              disabled={submitting || !reply.trim()}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Reply'}
            </button>
          </div>
        </div>
          </>
        )}
      </form>
    </div>
  );
}
