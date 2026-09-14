'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { FeedbackComment, IssueOptions, Pin } from '@/lib/types';
import { useProjectLiveEvents } from '@/components/LiveEventsProvider';
import { MENTION_RE } from '@/lib/mentions';
import { formatDateTime } from '@/lib/date-format';
import { dashboardHeaders } from '@/lib/client-origin';
import {
  buildIssueHandoffV1,
  renderIssueHandoffMarkdown,
  type BuildIssueHandoffInput,
} from '@/lib/issue-handoff';
import IssueMetadataEditor, { type IssueMetadataUpdate } from './IssueMetadataEditor';

type ThreadPin = Omit<Pin, 'annotations'> & Partial<Pick<Pin, 'annotations'>>;
type HandoffContext = Omit<BuildIssueHandoffInput, 'dashboardOrigin' | 'pin'>;

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

// Hard cap on a single paste / drop. Matches the server-side
// MAX_ATTACHMENT_BYTES (8MB) so the user gets a client-side
// warning before the roundtrip. The server is the source of
// truth — this cap exists to avoid spending a network roundtrip
// on a payload that will be rejected anyway.
const MAX_PASTE_BYTES = 8 * 1024 * 1024;

export default function PinThread({
  pin,
  projectId,
  readOnly = false,
  canManageComments = false,
  showDeveloperContext = false,
  issueOptions,
  handoffContext,
  onClose,
  onStatusChange,
  onMetadataChange,
  onCommentAdded,
  onCommentUpdated,
  onCommentDeleted,
}: {
  pin: ThreadPin;
  /**
   * The project this pin belongs to. Used to scope live-event handling
   * so a new-comment event for THIS pin triggers an optimistic append.
   * Optional — when omitted (e.g. a unit test renders the thread in
   * isolation, or the public share view has no LiveEventsProvider),
   * useProjectLiveEvents no-ops and the thread falls back to the
   * props-driven comment list. Share is read-only.
   */
  projectId?: string | null;
  /**
   * Hide the reply form and the open/resolved toggle. Used by the
   * public /share/[token] view. Existing comments are still rendered
   * read-only so a share-link viewer can follow the conversation
   * history — they just can't add to it.
   */
  readOnly?: boolean;
  /** Explicit project-administrator capability for editing or deleting comments. */
  canManageComments?: boolean;
  /** Technical capture details are restricted to project administrators. */
  showDeveloperContext?: boolean;
  /** Internal workflow choices; presence also gates the editor to administrators. */
  issueOptions?: IssueOptions;
  /** Project/page/screenshot identity needed to build the canonical issue payload. */
  handoffContext?: HandoffContext;
  onClose: () => void;
  onStatusChange: (pinId: string, status: 'OPEN' | 'RESOLVED') => Promise<void>;
  onMetadataChange?: (pinId: string, update: IssueMetadataUpdate) => Promise<void>;
  onCommentAdded: (pinId: string, comment: FeedbackComment) => void;
  /** Returns the updated comment after a successful administrator edit. */
  onCommentUpdated?: (pinId: string, commentId: string, text: string) => Promise<FeedbackComment | null>;
  /** Returns true only after a successful administrator deletion. */
  onCommentDeleted?: (pinId: string, commentId: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [author, setAuthor] = useState('Reviewer');
  const [handoffCopyState, setHandoffCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [comments, setComments] = useState<FeedbackComment[]>(pin.comments);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [commentMutationPending, setCommentMutationPending] = useState<string | null>(null);
  const [commentMutationError, setCommentMutationError] = useState<string | null>(null);

  useEffect(() => {
    setComments(pin.comments);
  }, [pin.comments]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  // === Attachments (paste-then-submit) ===================================
  // pendingAttachments holds the attachmentIds returned by
  // /api/attachments for images the user pasted (or dropped)
  // into the textarea. The ids are stored locally and sent
  // with the comment on submit — the actual file bytes are
  // already in /data/attachments at that point.
  //
  // uploadsInFlight tracks the count of currently-uploading
  // pastes. The Reply button is disabled while uploads are
  // pending so the user can't submit a comment without the
  // attachment rows. uploadErrors surfaces the most recent
  // paste failure to the user (rate-limited, too large, etc.).
  const [pendingAttachments, setPendingAttachments] = useState<{ id: string; url: string; mimeType: string; size: number }[]>([]);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Pending-paste preview URLs (ObjectURLs). We need to keep
  // these alive while the paste preview is on screen, and
  // revoke them when the comment is submitted / cancelled.
  // The map is keyed by attachmentId so multiple pastes can
  // coexist with their own previews.
  const pendingPreviewsRef = useRef<Map<string, string>>(new Map());

  // Revoke any pending ObjectURLs on unmount. A user who
  // closes the PinThread mid-paste (e.g. navigates away) would
  // otherwise leak the blob references until the page
  // garbage-collects them. useEffect's cleanup runs on
  // unmount AND when the component re-runs (e.g. dev Strict
  // Mode's double-invoke), so the previews stay tidy.
  useEffect(() => {
    // Capture the current ref value so the cleanup function
    // uses the value at effect time, not whatever the ref is
    // when React tears the effect down (the lint rule is
    // warning us about the right thing here).
    const current = pendingPreviewsRef.current;
    return () => {
      for (const previewUrl of current.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      current.clear();
    };
  }, []);

  // === Live updates (SSE) =================================================
  // Subscribe via the project LiveEventsProvider fan-out and
  // optimistically append any new-comment event whose pinId matches
  // the pin we're rendering. The dispatch goes through onCommentAdded
  // (the same callback the POST handler uses) so the parent
  // ScreenshotView owns the source of truth for the comment list.
  // ProjectDetail also refreshes from the same stream — both layers
  // dedupe on comment id, and a slow SSE event combined with a slow
  // POST roundtrip can never double-append.
  //
  // Note: we filter on `pin.id` here, NOT on the screenshot id,
  // because the route's emit() carries the pinId, not the
  // screenshotId, in the payload. Multiple PinThread instances can
  // be open (one per pin) but only the one whose `pin.id` matches
  // the event will fire onCommentAdded.
  //
  // Outside LiveEventsProvider (share / isolated tests) this no-ops.
  // `projectId` remains part of the public props API; the provider
  // owns the EventSource, so a missing projectId skips handling.
  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  const onLiveEvent = useCallback((event: { type: string; payload: unknown }) => {
    if (!projectId) return;
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
        if (commentsRef.current.some((c) => c.id === payload.comment.id)) return;
        setComments((current) => current.some((comment) => comment.id === payload.comment.id)
          ? current
          : [...current, payload.comment]);
        onCommentAdded(pin.id, payload.comment);
      }
    }
  }, [projectId, pin.id, onCommentAdded]);
  useProjectLiveEvents(onLiveEvent);

  // === Paste handler =====================================================
  // Intercept paste events on the textarea. If the clipboard
  // contains an image (the dominant case: Cmd+V a screenshot
  // from a screenshot tool), POST it to /api/attachments and
  // store the returned id in `pendingAttachments`. The image
  // shows up inline in the preview row above the textarea; the
  // id rides along on the next submit.
  //
  // We DON'T swallow the default paste behaviour for non-image
  // pastes (e.g. plain text) — the textarea still receives the
  // pasted text normally. The handler returns early without
  // calling `e.preventDefault()` so the textarea state stays
  // consistent.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    // Find the first image item. clipboardData.items is a
    // DataTransferItemList; we iterate and pick the first kind
    // === 'file' with a type starting with 'image/'. The
    // browser's clipboard reader (navigator.clipboard.read)
    // would also work, but it requires a Permissions-Policy
    // allowlist and only ships the bytes as Blob — using
    // clipboardData is the same UX with fewer prereqs.
    let imageFile: File | null = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          imageFile = f;
          break;
        }
      }
    }
    if (!imageFile) return;
    // We DO have an image. Stop the textarea from receiving
    // the paste (which would be a no-op anyway, since the
    // clipboard is binary), and upload.
    e.preventDefault();
    await uploadPastedImage(imageFile);
  };

  // Upload a pasted image to /api/attachments. The route
  // returns { success, data: { id, url, kind, size } } on
  // success. On failure, the route's error message is shown
  // inline so the user can retry. The 8MB cap is mirrored
  // here so we don't waste a roundtrip on a payload that
  // would be rejected.
  const uploadPastedImage = async (file: File) => {
    setUploadError(null);
    if (file.size > MAX_PASTE_BYTES) {
      setUploadError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB limit).`);
      return;
    }
    if (file.size === 0) {
      setUploadError('Pasted image is empty.');
      return;
    }
    setUploadsInFlight((n) => n + 1);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'pasted.png');
      if (projectId) fd.append('projectId', projectId);
      const res = await fetch('/api/attachments', {
        method: 'POST',
        headers: dashboardHeaders(),
        body: fd,
      });
      if (!res.ok) {
        // Surface the server's error message verbatim — the
        // route returns specific text like "file too large" or
        // "unsupported file type" that helps the user fix the
        // paste. Fall back to a generic message if the body
        // isn't JSON.
        let msg = `Upload failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* leave msg as the generic */ }
        setUploadError(msg);
        return;
      }
      const data = await res.json();
      const att = data.data;
      // Build a local ObjectURL for the preview. The preview
      // is shown above the textarea so the user sees the
      // pasted image even before submit. The URL is revoked
      // on submit / unmount (pendingPreviewsRef).
      const previewUrl = URL.createObjectURL(file);
      pendingPreviewsRef.current.set(att.id, previewUrl);
      setPendingAttachments((prev) => [
        ...prev,
        { id: att.id, url: att.url, mimeType: file.type, size: file.size },
      ]);
    } catch (err) {
      // Network error, abort, etc. — don't leave the user
      // staring at a silent failure.
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadsInFlight((n) => n - 1);
    }
  };

  // Remove a pending attachment (e.g. user changed their mind
  // before submitting). The Attachment row is left in place
  // for now — the route's "orphan" semantics mean a row with
  // commentId=null just doesn't render in the comment thread.
  // A future prune job could garbage-collect orphans, but in
  // practice the dashboard's paste-then-submit flow uploads
  // and submits in the same user gesture, so orphans
  // shouldn't accumulate. (The on-disk file is also not
  // deleted — same reasoning.)
  const removePendingAttachment = (id: string) => {
    const previewUrl = pendingPreviewsRef.current.get(id);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      pendingPreviewsRef.current.delete(id);
    }
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Defense in depth: the form is hidden when readOnly, but if a
    // future change re-renders it the post must still no-op so a
    // share-link viewer can't fake a comment.
    if (readOnly) return;
    // Must have EITHER text OR pending attachments. We loosened
    // this from "must have text" so paste-only replies work.
    if (!reply.trim() && pendingAttachments.length === 0) return;
    if (submitting || uploadsInFlight > 0) return;
    setSubmitting(true);
    setCommentMutationError(null);
    try {
      const res = await fetch(`/api/pins/${pin.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
        body: JSON.stringify({
          text: reply,
          author,
          authorRole: 'reviewer',
          // The comment-create route's `connect: [{ id }]` binds
          // these orphan attachments to the new comment. After
          // the response, we revoke the preview ObjectURLs and
          // clear the local state so the next reply starts clean.
          attachmentIds: pendingAttachments.map((a) => a.id),
        }),
      });
      if (!res.ok) {
        let message = `Could not send this reply (${res.status}).`;
        try {
          const body = await res.json();
          if (typeof body?.error === 'string' && body.error.trim()) message = body.error;
        } catch { /* keep the status-based fallback */ }
        setCommentMutationError(message);
        return;
      }
      const data = await res.json();
      onCommentAdded(pin.id, data.data);
      setReply('');
      // Free the preview ObjectURLs. The server has the bytes
      // on disk now; the <img> in the new comment will fetch
      // them from /api/attachments/[id] (dashboard origin
      // authenticated), so the local blob is no longer needed.
      for (const [, previewUrl] of pendingPreviewsRef.current.entries()) {
        URL.revokeObjectURL(previewUrl);
      }
      pendingPreviewsRef.current.clear();
      setPendingAttachments([]);
    } catch (error) {
      setCommentMutationError(error instanceof Error ? error.message : 'Could not send this reply.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = () => {
    if (readOnly) return;
    const next = pin.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    onStatusChange(pin.id, next);
  };

  const startCommentEdit = (comment: FeedbackComment) => {
    if (readOnly || !canManageComments) return;
    setCommentMutationError(null);
    setDeleteConfirmationId(null);
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  };

  const saveCommentEdit = async (commentId: string) => {
    if (readOnly || !canManageComments || !onCommentUpdated || commentMutationPending) return;
    const text = editingText.trim();
    if (!text) {
      setCommentMutationError('Comment text cannot be empty.');
      return;
    }
    setCommentMutationPending(commentId);
    setCommentMutationError(null);
    try {
      const updated = await onCommentUpdated(pin.id, commentId, text);
      if (!updated) {
        setCommentMutationError('Could not save this comment.');
        return;
      }
      setComments((current) => current.map((comment) => comment.id === commentId
        ? { ...comment, ...updated, attachments: updated.attachments ?? comment.attachments }
        : comment));
      setEditingCommentId(null);
      setEditingText('');
    } catch (error) {
      setCommentMutationError(error instanceof Error ? error.message : 'Could not save this comment.');
    } finally {
      setCommentMutationPending(null);
    }
  };

  const confirmCommentDelete = async (commentId: string) => {
    if (readOnly || !canManageComments || !onCommentDeleted || commentMutationPending) return;
    setCommentMutationPending(commentId);
    setCommentMutationError(null);
    try {
      const deleted = await onCommentDeleted(pin.id, commentId);
      if (!deleted) {
        setCommentMutationError('Could not delete this comment.');
        return;
      }
      setComments((current) => current.filter((comment) => comment.id !== commentId));
      setDeleteConfirmationId(null);
    } catch (error) {
      setCommentMutationError(error instanceof Error ? error.message : 'Could not delete this comment.');
    } finally {
      setCommentMutationPending(null);
    }
  };

  const copyDeveloperHandoff = async () => {
    if (!handoffContext) return;
    setHandoffCopyState('idle');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      const payload = buildIssueHandoffV1({
        ...handoffContext,
        dashboardOrigin: window.location.origin,
        pin: { ...pin, annotations: pin.annotations ?? [] },
      });
      await navigator.clipboard.writeText(renderIssueHandoffMarkdown(payload));
      setHandoffCopyState('copied');
    } catch {
      setHandoffCopyState('error');
    }
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
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close comment thread"
          className="flex min-h-11 min-w-11 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {showDeveloperContext && issueOptions && onMetadataChange ? (
        <IssueMetadataEditor
          pin={{ ...pin, annotations: pin.annotations ?? [] }}
          options={issueOptions}
          onSave={(update) => onMetadataChange(pin.id, update)}
        />
      ) : null}

      {showDeveloperContext && (
        <details className="mb-4 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-700">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium text-gray-800">
            Developer context
          </summary>
          <div className="space-y-3 border-t border-gray-200 px-3 py-3">
            {handoffContext && (
              <div>
                <button
                  type="button"
                  onClick={copyDeveloperHandoff}
                  className="rounded border border-blue-300 bg-white px-2 py-1 font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {handoffCopyState === 'copied' ? 'Copied' : 'Copy developer handoff'}
                </button>
                <p className="mt-1 text-[11px] text-gray-500">
                  Copies a privacy-safe Markdown issue.
                </p>
                {handoffCopyState === 'error' && (
                  <p role="alert" className="mt-2 text-red-700">
                    Clipboard access failed. Check browser permissions and try again.
                  </p>
                )}
              </div>
            )}
            {!pin.developerContext ? (
              <p className="text-gray-500">Not captured for this pin.</p>
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-gray-500">Page</dt>
                  <dd className="min-w-0 break-all">
                    {pin.developerContext.pageUrl ? (
                      <a
                        href={pin.developerContext.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline decoration-blue-300 underline-offset-2"
                      >
                        {pin.developerContext.pageUrl}
                      </a>
                    ) : pin.developerContext.route}
                  </dd>
                  <dt className="text-gray-500">Route</dt>
                  <dd className="break-all font-mono">{pin.developerContext.route}</dd>
                  <dt className="text-gray-500">Viewport</dt>
                  <dd>
                    {pin.developerContext.viewport
                      ? `${pin.developerContext.viewport.width} × ${pin.developerContext.viewport.height}${pin.developerContext.viewport.devicePixelRatio ? ` @ ${pin.developerContext.viewport.devicePixelRatio}x` : ''}`
                      : 'Unknown'}
                  </dd>
                  <dt className="text-gray-500">Environment</dt>
                  <dd>{pin.developerContext.browser} · {pin.developerContext.platform}</dd>
                  <dt className="text-gray-500">Screenshot</dt>
                  <dd>
                    {pin.developerContext.screenshot.width} × {pin.developerContext.screenshot.height}
                    {' · '}{formatDateTime(pin.developerContext.screenshot.capturedAt)}
                  </dd>
                  <dt className="text-gray-500">Review</dt>
                  <dd>
                    {pin.developerContext.reviewRound
                      ? `Round ${pin.developerContext.reviewRound.number}${pin.developerContext.reviewRound.name ? ` · ${pin.developerContext.reviewRound.name}` : ''}`
                      : 'No review round'}
                  </dd>
                </dl>

                {pin.developerContext.selectors.length > 0 && (
                  <div>
                    <p className="mb-1 text-gray-500">Selector candidates</p>
                    <div className="space-y-1">
                      {pin.developerContext.selectors.map((selector) => (
                        <code key={selector} className="block overflow-x-auto rounded bg-gray-900 px-2 py-1 text-[11px] text-gray-100">
                          {selector}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {pin.developerContext.elementSnippet && (
                  <div>
                    <p className="mb-1 text-gray-500">Element snippet</p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-900 px-2 py-2 text-[11px] text-gray-100">
                      {pin.developerContext.elementSnippet}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      )}

      <div className="space-y-3 mb-4">
        {comments.map((c) => (
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
              <span className="ml-2">{formatDateTime(c.createdAt)}</span>
            </div>
            {/* Highlight @mentions. The split uses the same regex as
                the server-side parseMentions so what the recipient
                sees in the email body matches what's highlighted in
                the UI. Splitting on the full match (including the @)
                keeps the original characters in the output, so screen
                readers still read "@alice@example.com" as text. */}
            {editingCommentId === c.id ? (
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium text-gray-700" htmlFor={`edit-comment-${c.id}`}>
                  Edit comment by {c.author}
                </label>
                <textarea
                  id={`edit-comment-${c.id}`}
                  aria-label={`Edit comment by ${c.author}`}
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-300 p-2 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveCommentEdit(c.id)}
                    disabled={commentMutationPending === c.id}
                    className="min-h-[44px] rounded bg-blue-700 px-3 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {commentMutationPending === c.id ? 'Saving…' : 'Save edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingCommentId(null); setEditingText(''); setCommentMutationError(null); }}
                    disabled={commentMutationPending === c.id}
                    className="min-h-[44px] rounded border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel edit
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-800 whitespace-pre-wrap">
                {renderCommentText(c.text)}
              </div>
            )}
            {/* Inline attachments. The server-side Comment response
                carries `attachments: FeedbackAttachment[]` (see
                src/lib/types.ts). Each attachment has a relative
                `url` the dashboard fetches from /api/attachments/[id]
                — the GET route accepts the authenticated dashboard session
                or the managed review's HttpOnly access cookie. We
                only render <img> tags for the 'image' kind in
                this round; voice / video are reserved for the
                future and would use <audio> / <video> elements.
                The `max-h-64` keeps a giant screenshot from
                breaking the comment bubble's layout. The
                `loading="lazy"` defers off-screen images so a
                long thread of attachments doesn't block the
                initial paint. */}
            {c.attachments && c.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {c.attachments.map((a) => {
                  if (a.kind === 'image') {
                    return (
                      // eslint-disable-next-line @next/next/no-img-element -- served from /api/attachments/[id] with the row's mimeType; the disk-backed stream and the dashboard's same-origin auth are intentional (not a static asset the optimizer can help with).
                      <img
                        key={a.id}
                        src={a.url}
                        alt={a.mimeType}
                        loading="lazy"
                        className="max-h-64 max-w-full rounded border border-gray-200"
                      />
                    );
                  }
                  // Voice / video reserved for a future surface.
                  // Render a labelled placeholder so the kind is
                  // visible to a reader even before the player
                  // lands. The mimeType is shown so the user
                  // knows what the file is.
                  return (
                    <div
                      key={a.id}
                      className="text-xs text-gray-500 border border-dashed border-gray-300 rounded px-2 py-1"
                    >
                      {a.kind} attachment ({a.mimeType})
                    </div>
                  );
                })}
              </div>
            )}
            {canManageComments && !readOnly && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
                {deleteConfirmationId === c.id ? (
                  <>
                    <p className="w-full text-xs text-red-800">Delete this comment? This cannot be undone.</p>
                    <button
                      type="button"
                      onClick={() => void confirmCommentDelete(c.id)}
                      disabled={commentMutationPending === c.id}
                      className="min-h-[44px] rounded bg-red-700 px-3 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {commentMutationPending === c.id ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleteConfirmationId(null); setCommentMutationError(null); }}
                      disabled={commentMutationPending === c.id}
                      className="min-h-[44px] rounded border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Keep comment
                    </button>
                  </>
                ) : editingCommentId !== c.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => startCommentEdit(c)}
                      className="min-h-[44px] rounded px-3 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      Edit comment
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleteConfirmationId(c.id); setEditingCommentId(null); setCommentMutationError(null); }}
                      className="min-h-[44px] rounded px-3 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Delete comment
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {commentMutationError && (
        <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800">
          {commentMutationError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        {/* The reply form is dashboard-only. The /share/[token] view
            shows the conversation history but does not let a
            share-link viewer add to it. Hiding the whole form (not
            just disabling it) is what the task asks for — the
            "read-only" UX should look read-only, not "muted and
            half-broken". */}
        {!readOnly && (
          <>
        {/* Pending attachment previews. Each entry is a row of
            [thumbnail × remove]. The thumbnail uses the local
            ObjectURL (from URL.createObjectURL on the File) so
            the user sees what they pasted instantly, even
            before the upload roundtrip. The × button removes
            the pending attachment — the server's Attachment
            row stays in place (orphan), and the on-disk file
            is not deleted. A future prune job could clean up
            orphans; in practice, the upload-then-submit flow
            binds them in the same user gesture. */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map((a) => {
              const previewUrl = pendingPreviewsRef.current.get(a.id);
              return (
                <div
                  key={a.id}
                  className="relative inline-block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local ObjectURL, not a static asset the optimizer can resolve. */}
                  <img
                    src={previewUrl ?? a.url}
                    alt="pasted attachment"
                    className="max-h-20 max-w-[120px] rounded border border-gray-300"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(a.id)}
                    aria-label="Remove attachment"
                    className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {/* Upload error — the paste produced a server-side
            failure (too large, unsupported kind, 5xx). The
            message is verbatim from the route's body so the
            user can act on it. We clear it on the next paste
            or on submit. */}
        {uploadError && (
          <div role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {uploadError}
          </div>
        )}
        <textarea
          aria-label="Reply to this feedback"
          value={reply}
          onChange={e => setReply(e.target.value)}
          onPaste={handlePaste}
          placeholder="Reply... (paste a screenshot to attach an image)"
          className="w-full border border-gray-300 rounded p-2 text-sm resize-none"
          rows={2}
        />
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            aria-label="Your name"
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
              // The Reply button is enabled when EITHER the
              // textarea has text OR there's a pending
              // attachment (a paste-only reply is valid).
              // The button is also disabled while uploads are
              // in flight so the user can't submit a comment
              // before the attachment rows exist.
              disabled={submitting || uploadsInFlight > 0 || (!reply.trim() && pendingAttachments.length === 0)}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : uploadsInFlight > 0 ? 'Uploading...' : 'Reply'}
            </button>
          </div>
        </div>
          </>
        )}
      </form>
    </div>
  );
}
