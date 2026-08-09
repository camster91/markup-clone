'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import PinThread from './PinThread';
import HistoryPanel from './HistoryPanel';
import type { Pin, FeedbackComment, ScreenshotWithPins, FeedbackAnnotation, IssueOptions } from '@/lib/types';
import { useRecaptureStatus } from '@/lib/hooks/useRecaptureStatus';
import { colorForUserId, shortLabelForUserId, type PresenceActivity, type PresenceRow } from '@/lib/hooks/usePresence';
import { formatDateTime } from '@/lib/date-format';
import { dashboardHeaders } from '@/lib/client-origin';
import type { IssueMetadataUpdate } from './IssueMetadataEditor';
import { pinMatchesIssueFilters, type IssueFilters as IssueFilterValue } from '@/lib/issue-metadata';

export default function ScreenshotView({
  screenshot,
  pagePath,
  projectId,
  projectName,
  projectDomain,
  showDeveloperContext = false,
  canManageComments = false,
  issueOptions,
  issueFilters,
  onProjectUpdated,
  presenceOthers = [],
  onPresenceActivity,
  /**
   * Render the screenshot read-only. When true:
   *   - The recapture button is hidden (no headless-Chromium cost
   *     for someone who only has the share link).
   *   - The PinThread form is disabled (no new comments).
   *   - Pin status changes (open/resolved) are blocked.
   *   - No authenticated collaboration transport starts in this
   *     component; public shares remain presence-free.
   *
   * Used by /share/[token] (the public view) and any future
   * embed that doesn't want to expose the dashboard's mutation
   * surface.
   */
  readOnly = false,
}: {
  screenshot: ScreenshotWithPins;
  pagePath: string;
  /**
   * Project this screenshot belongs to. Used for issue handoff and comment
   * context; public read-only screenshots may omit it.
   */
  projectId?: string;
  projectName?: string;
  projectDomain?: string;
  /** Show privacy-bounded technical capture details to project administrators. */
  showDeveloperContext?: boolean;
  /** Explicit project-administrator capability for comment edit/delete controls. */
  canManageComments?: boolean;
  /** Owner/operator-only assignee and reusable tag choices. */
  issueOptions?: IssueOptions;
  /** Owner/operator-only filters applied to the locally live pin collection. */
  issueFilters?: IssueFilterValue;
  /** Refresh the parent DTO after an internal mutation so global counts/options stay current. */
  onProjectUpdated?: () => Promise<void> | void;
  /** Shared project presence; this screenshot renders matching cursors only. */
  presenceOthers?: PresenceRow[];
  /** Report focused screenshot/cursor activity to the project-owned heartbeat. */
  onPresenceActivity?: (activity: PresenceActivity) => void;
  readOnly?: boolean;
}) {
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>(screenshot.pins);
  const [width, setWidth] = useState(screenshot.width);
  const [height, setHeight] = useState(screenshot.height);
  const [capturedAt, setCapturedAt] = useState(screenshot.capturedAt);
  const [imageKey, setImageKey] = useState(0); // bump to force img reload
  const visiblePins = useMemo(
    () => issueFilters ? pins.filter((pin) => pinMatchesIssueFilters(pin, issueFilters)) : pins,
    [issueFilters, pins]
  );

  const updatePinQuery = useCallback((pinId: string | null) => {
    const url = new URL(window.location.href);
    if (pinId) url.searchParams.set('pin', pinId);
    else url.searchParams.delete('pin');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const requestedPinId = new URLSearchParams(window.location.search).get('pin');
    if (requestedPinId && visiblePins.some((pin) => pin.id === requestedPinId)) {
      setActivePinId(requestedPinId);
    } else if (activePinId && !visiblePins.some((pin) => pin.id === activePinId)) {
      updatePinQuery(null);
      setActivePinId(null);
    }
  }, [activePinId, updatePinQuery, visiblePins]);
  // === History tab =====================================================
  // 'latest' (default) renders the screenshot + pins as before.
  // 'history' renders HistoryPanel — the last 50 ScreenshotVersion
  // rows as thumbnails. We keep the tabs as local state so flipping
  // between them is instant (no re-fetch of pins / pins-state stays
  // alive) but the HistoryPanel is unmounted when not active (its
  // <img>s and dialog state are torn down). The HistoryPanel watches
  // `imageKey` as a refresh signal — every successful recapture bumps
  // imageKey, and the panel re-fetches the version list so the new
  // capture shows up at the top of the grid.
  const [tab, setTab] = useState<'latest' | 'history'>('latest');
  const latestTabRef = useRef<HTMLButtonElement | null>(null);
  const historyTabRef = useRef<HTMLButtonElement | null>(null);
  const activePinTriggerRef = useRef<HTMLButtonElement | null>(null);
  const latestTabId = `screenshot-${screenshot.id}-latest-tab`;
  const historyTabId = `screenshot-${screenshot.id}-history-tab`;
  const latestPanelId = `screenshot-${screenshot.id}-latest-panel`;
  const historyPanelId = `screenshot-${screenshot.id}-history-panel`;
  const imgUrl = `/api/screenshots/${screenshot.id}/image?v=${imageKey}`;

  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    let next: 'latest' | 'history' | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = tab === 'latest' ? 'history' : 'latest';
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = tab === 'history' ? 'latest' : 'history';
    } else if (event.key === 'Home') {
      next = 'latest';
    } else if (event.key === 'End') {
      next = 'history';
    }
    if (!next) return;
    event.preventDefault();
    setTab(next);
    (next === 'latest' ? latestTabRef : historyTabRef).current?.focus();
  }, [tab]);

  const closePinThread = useCallback(() => {
    updatePinQuery(null);
    setActivePinId(null);
    queueMicrotask(() => activePinTriggerRef.current?.focus());
  }, [updatePinQuery]);

  // Stable initial-dims reference so the recapture hook doesn't re-fire
  // on every parent re-render. capturedAt is a string from the server,
  // so an object identity comparison is enough.
  const initialDims = useMemo(
    () => ({ width: screenshot.width, height: screenshot.height, capturedAt: screenshot.capturedAt }),
    [screenshot.width, screenshot.height, screenshot.capturedAt]
  );

  // onUpdate is recreated every render; the hook depends on it via
  // useCallback closure. Wrap in useCallback so the hook's internal
  // start() reference is stable across renders that don't change the
  // dims.
  const handleRecaptureUpdate = useCallback((dims: { width: number; height: number; capturedAt: string }) => {
    setWidth(dims.width);
    setHeight(dims.height);
    setCapturedAt(dims.capturedAt);
    setImageKey((k) => k + 1);
  }, []);

  const { status: recaptureStatus, error: recaptureError, isStale, start: startRecapture } = useRecaptureStatus(
    screenshot.id,
    { onUpdate: handleRecaptureUpdate, initial: initialDims }
  );

  const handleRecapture = useCallback(() => {
    void startRecapture();
  }, [startRecapture]);

  // === Mouse tracking → project-owned presence ===========================
  // Translate
  // browser-space event coords into the screenshot's coordinate space
  // (0-100 percent of width/height). The next tick picks up whatever
  // is in the ref at that moment — no per-event throttling needed.
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // Clamp to [0, 100] — the cursor is over the image element but
    // React's synthetic event may fire on padding/border that
    // doesn't correspond to a real pixel.
    const x = Math.max(0, Math.min(100, xPct));
    const y = Math.max(0, Math.min(100, yPct));
    onPresenceActivity?.({ screenshotId: screenshot.id, x, y });
  }, [onPresenceActivity, screenshot.id]);

  const handleMouseLeave = useCallback(() => {
    onPresenceActivity?.({ screenshotId: screenshot.id, x: null, y: null });
  }, [onPresenceActivity, screenshot.id]);

  const handlePinStatusChange = async (pinId: string, status: 'OPEN' | 'RESOLVED') => {
    // Share-link viewers (readOnly) cannot change pin status — the
    // PATCH /api/pins/[id] route requires dashboard origin, but we
    // also short-circuit here so the UI is internally consistent
    // (no optimistic state update that would silently fail).
    if (readOnly) return;
    const res = await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setPins(prev => prev.map(p => p.id === pinId ? { ...p, status } : p));
    }
  };

  const handlePinMetadataChange = async (pinId: string, update: IssueMetadataUpdate) => {
    if (readOnly || !showDeveloperContext) return;
    const res = await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      let message = 'Could not save issue details';
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Preserve the generic message for an invalid response body.
      }
      throw new Error(message);
    }
    const body = await res.json();
    const updated = body.data as Pick<Pin, 'priority' | 'assignee' | 'tags'>;
    setPins((previous) => previous.map((pin) => pin.id === pinId ? {
      ...pin,
      priority: updated.priority,
      assignee: updated.assignee,
      tags: updated.tags,
    } : pin));
    await onProjectUpdated?.();
  };

  const handleCommentAdded = (pinId: string, comment: FeedbackComment) => {
    // The PinThread won't call this in readOnly mode (the form is
    // hidden), but we still no-op here for defense in depth: a
    // future change that wires the form back in shouldn't be able to
    // smuggle state mutations through.
    if (readOnly) return;
    setPins(prev => prev.map(p => p.id === pinId ? { ...p, comments: [...p.comments, comment] } : p));
  };

  const handleCommentUpdated = async (pinId: string, commentId: string, text: string): Promise<FeedbackComment | null> => {
    if (readOnly || !canManageComments) return null;
    const res = await fetch(`/api/pins/${pinId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...dashboardHeaders() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      let message = 'Could not save this comment';
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Preserve the generic message when the response is not JSON.
      }
      throw new Error(message);
    }
    const body = await res.json();
    const updated = body.data as FeedbackComment;
    setPins((previous) => previous.map((pin) => pin.id === pinId ? {
      ...pin,
      comments: pin.comments.map((comment) => comment.id === commentId
        ? { ...comment, ...updated, attachments: updated.attachments ?? comment.attachments }
        : comment),
    } : pin));
    return updated;
  };

  const handleCommentDeleted = async (pinId: string, commentId: string): Promise<boolean> => {
    if (readOnly || !canManageComments) return false;
    const res = await fetch(`/api/pins/${pinId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: dashboardHeaders(),
    });
    if (!res.ok) {
      let message = 'Could not delete this comment';
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Preserve the generic message when the response is not JSON.
      }
      throw new Error(message);
    }
    setPins((previous) => previous.map((pin) => pin.id === pinId ? {
      ...pin,
      comments: pin.comments.filter((comment) => comment.id !== commentId),
    } : pin));
    return true;
  };

  // === Annotation rendering ==============================================
  // Annotations are stored in the screenshot's PIXEL space (e.g. an
  // arrow on a 1920x1080 screenshot has its endpoints in [0,1920] ×
  // [0,1080]). The <img> is rendered responsively at `w-full h-auto`,
  // so the rendered size != the natural size. The SVG overlay fixes
  // that with a viewBox that matches the natural pixel dimensions —
  // SVG scales its viewBox to the rendered box automatically, so a
  // shape at (10, 20) lands at (10, 20) image-pixels regardless of
  // the dashboard's CSS layout.
  //
  // The shape is rendered by SvgAnnotation below. We hoist the
  // parsing (JSON.parse the pathJson) into a useMemo per-pin so the
  // SVG node list is stable across re-renders that don't change
  // annotations — important for React's keyed reconciliation.
  //
  // We render annotations ONLY for the active pin (when set) plus
  // all open pins when no pin is selected? No — we render for every
  // pin, but use a `pointer-events: none` wrapper so the SVG never
  // intercepts clicks. The pin buttons (rendered separately above
  // with `z-index: 5/10`) sit on top of the SVG (z-index implicit 0).
  // The active pin's annotations are emphasized (a thicker stroke)
  // to mirror the pin's "active" state.
  const annotationsSvg = (
    <svg
      data-testid="annotations-overlay"
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ zIndex: 3 }}
      aria-hidden="true"
    >
      {visiblePins.map((pin) => (
        <AnnotationGroup
          key={pin.id}
          pin={pin}
          isActive={activePinId === pin.id}
        />
      ))}
    </svg>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
          {/* Tab switcher. The "Latest" tab is the original
              ScreenshotView body (image + pins + annotations). The
              "History" tab mounts <HistoryPanel> in place of the
              body and tears down the rest. The image-bump
              cache-buster continues to work in both tabs because
              imgUrl is computed from the Screenshot id, not the
              active tab. */}
          <div role="tablist" aria-label="Screenshot view" className="flex items-center gap-1">
            <button
              ref={latestTabRef}
              id={latestTabId}
              type="button"
              role="tab"
              aria-selected={tab === 'latest'}
              aria-controls={latestPanelId}
              tabIndex={tab === 'latest' ? 0 : -1}
              data-testid="tab-latest"
              onClick={() => setTab('latest')}
              onKeyDown={handleTabKeyDown}
              className={`px-2 py-1 rounded text-xs font-medium ${
                tab === 'latest'
                  ? 'bg-white text-gray-900 border border-gray-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Latest
            </button>
            <button
              ref={historyTabRef}
              id={historyTabId}
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              aria-controls={historyPanelId}
              tabIndex={tab === 'history' ? 0 : -1}
              data-testid="tab-history"
              onClick={() => setTab('history')}
              onKeyDown={handleTabKeyDown}
              className={`px-2 py-1 rounded text-xs font-medium ${
                tab === 'history'
                  ? 'bg-white text-gray-900 border border-gray-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              History
            </button>
          </div>
          <span>
            {tab === 'latest'
              ? <>Captured: {formatDateTime(capturedAt)} · {width}×{height}px</>
              : 'Every recapture of this screenshot'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {tab === 'latest' && (
            <>
              <span className="text-gray-400">
                {visiblePins.length} pin{visiblePins.length === 1 ? '' : 's'}
              </span>
              <span className="text-gray-400">
                {visiblePins.filter(p => p.status === 'RESOLVED').length} resolved
              </span>
            </>
          )}
          {/* The recapture button shells out to headless Chromium
              and is dashboard-only. Hidden on the public /share/[token]
              view (readOnly) so a share-link viewer can't trigger a
              server-side render of arbitrary URLs. The pin-status
              toggle is also gated — see the PinThread and
              handlePinStatusChange below. */}
          {!readOnly && (
            <button
              type="button"
              onClick={handleRecapture}
              disabled={recaptureStatus === 'starting' || recaptureStatus === 'running'}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title={recaptureError || 'Server-side recapture via headless Chromium'}
            >
              {recaptureStatus === 'idle' && 'Recapture'}
              {recaptureStatus === 'starting' && 'Starting…'}
              {recaptureStatus === 'running' && (isStale ? 'Still rendering…' : 'Capturing…')}
              {recaptureStatus === 'done' && '✓ Refreshed'}
              {recaptureStatus === 'error' && '✗ Failed'}
            </button>
          )}
        </div>
      </div>

      {tab === 'latest' ? (

      <div
        ref={containerRef}
        id={latestPanelId}
        role="tabpanel"
        aria-labelledby={latestTabId}
        className="relative"
        style={{ maxWidth: '100%' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from /api/screenshots/[id]/image with immutable Cache-Control + ETag; the dynamic recapture cache-buster query string and the disk-backed PNG stream are intentional (not a static asset the optimizer can help with). */}
        <img
          src={imgUrl}
          alt={`Screenshot of ${pagePath}`}
          className="block w-full h-auto select-none"
          draggable={false}
        />
        {annotationsSvg}
        {visiblePins.map((pin, idx) => {
          const isActive = activePinId === pin.id;
          const isResolved = pin.status === 'RESOLVED';
          return (
            <button
              key={pin.id}
              type="button"
              aria-label={`${isResolved ? 'Resolved' : 'Open'} feedback pin ${idx + 1}: ${pin.comments[0]?.text || 'No comment'}`}
              aria-expanded={isActive}
              onClick={(event) => {
                if (isActive) {
                  closePinThread();
                } else {
                  activePinTriggerRef.current = event.currentTarget;
                  updatePinQuery(pin.id);
                  setActivePinId(pin.id);
                }
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md flex items-center justify-center font-bold text-white text-xs transition-transform hover:scale-110 ${
                isResolved ? 'bg-green-500' : 'bg-red-500'
              } ${isActive ? 'scale-125 ring-4 ring-blue-300' : ''}`}
              style={{
                left: `${pin.xPercent}%`,
                top: `${pin.yPercent}%`,
                width: 28,
                height: 28,
                zIndex: isActive ? 10 : 5,
              }}
              title={pin.comments[0]?.text || `Pin ${idx + 1}`}
            >
              {idx + 1}
            </button>
          );
        })}

        {/* Presence cursors rendered on top of the screenshot. Each
            "other" reviewer with a non-null cursor on this screenshot
            shows a small dot at `${xPercent}%` / `${yPercent}%`. The
            container div already has `position: relative`, so absolute
            positioning inside slots the dot over the image correctly. */}
        {presenceOthers
          .filter((p) => p.screenshotId === screenshot.id && p.cursorX !== null && p.cursorY !== null)
          .map((p) => (
            <div
              key={p.id}
              data-testid="presence-cursor"
              className={`absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md ${colorForUserId(p.userId)}`}
              style={{
                left: `${p.cursorX}%`,
                top: `${p.cursorY}%`,
                zIndex: 4,
              }}
              title={`Reviewer ${shortLabelForUserId(p.userId)}`}
              aria-label={`Reviewer ${shortLabelForUserId(p.userId)} cursor`}
            />
          ))}

        {activePinId && (
          <div
            className={`fixed inset-2 w-auto max-w-none max-h-none bg-white rounded-lg shadow-2xl border border-gray-200 z-20 overflow-y-auto sm:absolute sm:inset-auto sm:top-2 sm:right-2 sm:max-w-[calc(100%-1rem)] sm:max-h-[80vh] ${
              showDeveloperContext ? 'sm:w-[30rem] lg:w-[34rem]' : 'sm:w-80'
            }`}
            role="dialog"
            aria-modal="false"
            aria-label="Feedback thread"
          >
            {(() => {
              const pin = visiblePins.find(p => p.id === activePinId);
              if (!pin) return null;
              return (
                <PinThread
                  pin={pin}
                  projectId={projectId ?? null}
                  readOnly={readOnly}
                  showDeveloperContext={showDeveloperContext}
                  canManageComments={canManageComments}
                  issueOptions={issueOptions}
                  handoffContext={showDeveloperContext && projectId && projectName && projectDomain ? {
                    project: { id: projectId, name: projectName, domain: projectDomain },
                    pagePath,
                    screenshot: {
                      id: screenshot.id,
                      width,
                      height,
                      capturedAt,
                    },
                  } : undefined}
                  onClose={closePinThread}
                  onStatusChange={handlePinStatusChange}
                  onMetadataChange={handlePinMetadataChange}
                  onCommentAdded={handleCommentAdded}
                  onCommentUpdated={handleCommentUpdated}
                  onCommentDeleted={handleCommentDeleted}
                />
              );
            })()}
          </div>
        )}
      </div>
      ) : (
        // History tab — mount HistoryPanel. The panel is unmounted
        // when the user switches back to "Latest" (its fetch state,
        // dialog state, and <img> nodes are torn down), but the
        // screenshot's imageKey bump from a fresh recapture will
        // re-fetch the version list on the next mount.
        //
        // We pass `imageKey` as `refreshKey` so a successful
        // recapture (which bumps imageKey in the recapture-status
        // hook's onUpdate) causes the panel to re-fetch and show
        // the new version at the top of the grid.
        <div id={historyPanelId} role="tabpanel" aria-labelledby={historyTabId}>
          <HistoryPanel
            screenshotId={screenshot.id}
            refreshKey={imageKey}
          />
        </div>
      )}
    </div>
  );
}

// === Annotation rendering helpers ============================================
// Defined at module scope (not inside ScreenshotView) so the component
// identity is stable across renders — React's reconciler skips re-render
// for the same component reference when props don't change.

/** Memoized path-array extraction for an annotation. The server now
 *  returns `path` as a parsed `number[][]` (the projects and share
 *  routes do the JSON.parse at fetch time). Older code paths (the
 *  raw prisma row in tests, or the `new-pin` SSE event payload)
 *  might still pass `pathJson` as a string; we accept both for
 *  defense in depth. Returns [] for any shape we can't parse so the
 *  SVG never throws. */
function useParsedPath(annotation: FeedbackAnnotation & { pathJson?: string }): number[][] {
  return useMemo(() => {
    // Preferred: already-parsed path.
    if (Array.isArray(annotation.path) && annotation.path.length > 0) {
      return annotation.path;
    }
    // Fallback: string-shaped pathJson (older API surface, raw row
    // shape, or SSE payload).
    if (typeof annotation.pathJson === 'string') {
      try {
        const parsed = JSON.parse(annotation.pathJson);
        if (Array.isArray(parsed)) return parsed as number[][];
      } catch {
        // Fall through to []
      }
    }
    return [];
  }, [annotation.path, annotation.pathJson]);
}

/** Render a single annotation as the appropriate SVG element.
 *  - arrow:    <line x1=… y1=… x2=… y2=… stroke="…"/>
 *  - box:      <rect x=… y=… width=… height=… stroke="…"/>
 *  - freehand: <polyline points="x1,y1 x2,y2 …" stroke="…" fill="none"/>
 *
 *  All shapes are stroked, never filled — the design intent of
 *  markup.io's annotation system is overlay marks, not opaque
 *  shapes. Stroke color is a hot red (#DC2626) to match the active
 *  pin's bg, and the active pin's strokes are 3px thick while
 *  inactive pins use 2px so the focused pin's drawing is visually
 *  distinct from background noise. */
function SvgAnnotation({
  annotation,
  isActive,
}: {
  annotation: FeedbackAnnotation;
  isActive: boolean;
}) {
  const points = useParsedPath(annotation);
  if (points.length < 2) return null;
  const stroke = '#DC2626';
  const strokeWidth = isActive ? 3 : 2;
  const sw = strokeWidth;
  if (annotation.kind === 'arrow') {
    const [x1, y1] = points[0];
    const [x2, y2] = points[points.length - 1];
    return (
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={stroke} strokeWidth={sw} strokeLinecap="round"
        data-testid={`annotation-${annotation.kind}-${annotation.id}`}
      />
    );
  }
  if (annotation.kind === 'box') {
    const [x1, y1] = points[0];
    const [x2, y2] = points[points.length - 1];
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    return (
      <rect
        x={x} y={y} width={w} height={h}
        stroke={stroke} strokeWidth={sw} fill="none"
        data-testid={`annotation-${annotation.kind}-${annotation.id}`}
      />
    );
  }
  // freehand — polyline of every point. We don't simplify (RDP /
  // Douglas-Peucker) here: a few hundred points is well under the
  // SVG renderer's per-element budget, and the simplification would
  // be a second pass over the same data we just parsed.
  const pointsAttr = points.map(p => `${p[0]},${p[1]}`).join(' ');
  return (
    <polyline
      points={pointsAttr}
      stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round"
      data-testid={`annotation-${annotation.kind}-${annotation.id}`}
    />
  );
}

/** Group of annotations attached to a single pin. Wrapped in <g> so
 *  we can apply opacity / display styling to the whole group (e.g.
 *  fading out non-active pins when one pin is selected, though
 *  currently we render all annotations fully). */
function AnnotationGroup({
  pin,
  isActive,
}: {
  pin: Pin;
  isActive: boolean;
}) {
  if (!pin.annotations || pin.annotations.length === 0) return null;
  return (
    <g data-pin-id={pin.id} data-testid={`annotation-group-${pin.id}`}>
      {pin.annotations.map((a) => (
        <SvgAnnotation key={a.id} annotation={a} isActive={isActive} />
      ))}
    </g>
  );
}
