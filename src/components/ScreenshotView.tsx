'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import PinThread from './PinThread';
import type { Pin, FeedbackComment, ScreenshotWithPins, FeedbackAnnotation } from '@/lib/types';
import { useRecaptureStatus } from '@/lib/hooks/useRecaptureStatus';
import { usePresence, colorForUserId, shortLabelForUserId } from '@/lib/hooks/usePresence';
import { useLiveEvents } from '@/lib/hooks/useLiveEvents';

export default function ScreenshotView({
  screenshot,
  pagePath,
  projectId,
  /**
   * Render the screenshot read-only. When true:
   *   - The recapture button is hidden (no headless-Chromium cost
   *     for someone who only has the share link).
   *   - The PinThread form is disabled (no new comments).
   *   - Pin status changes (open/resolved) are blocked.
   *   - The presence/recapture poll loops and SSE subscription are
   *     still started, but a viewer without a project-scoped
   *     identity can't trigger any writes — the network is
   *     non-empty noise. (Could optimize by short-circuiting the
   *     hooks, but the gain is small for the v1 share link.)
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
   * Project this screenshot belongs to. Used to anchor the per-screenshot
   * presence heartbeat (collab card). Optional — when omitted (e.g. in
   * unit tests that only exercise the recapture poll loop), the
   * presence hook is skipped and the screenshot renders normally.
   */
  projectId?: string;
  readOnly?: boolean;
}) {
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>(screenshot.pins);
  const [width, setWidth] = useState(screenshot.width);
  const [height, setHeight] = useState(screenshot.height);
  const [capturedAt, setCapturedAt] = useState(screenshot.capturedAt);
  const [imageKey, setImageKey] = useState(0); // bump to force img reload
  const imgUrl = `/api/screenshots/${screenshot.id}/image?v=${imageKey}`;

  // === Presence (collab card) ============================================
  // We host a per-screenshot usePresence() call so the reviewer
  // associated with this ScreenshotView row gets a heartbeat tied to
  // THIS project + THIS screenshot. The "project-level" presence row
  // (no screenshotId) from the parent <ProjectCard> is still bumped
  // by the parent's usePresence — both heartbeats coexist; the one
  // with a screenshotId just carries the cursor position.
  //
  // Two issues to avoid:
  //   1) Double-bumping the row. Both heartbeats share the
  //      (userId, projectId) key, so the second upsert is a no-op
  //      "overwrite with the same values" — fine, and the screenshotId
  //      on the row will flip between null and the current screenshot
  //      id, which is what we want (it tells the dashboard "this
  //      reviewer is currently looking at screenshot X").
  //   2) Cursor lag. The 5s tick + 1s overlap cursor means the
  //      cursor position we POST is up to ~5s stale. That's fine for
  //      a "where is the reviewer roughly looking" indicator, which
  //      is the explicit design — the cursor is NOT pixel-accurate.
  //
  // We pass the cursor ref into the hook via `cursorRef`. The hook
  // reads `.current` on every tick; the ref is filled by the
  // onMouseMove handler below.
  //
  // The hook needs a projectId. The ScreenshotView doesn't have one
  // directly (the ScreenshotWithPins type stops at the screenshot).
  // We add a `screenshot.projectId` lookup via a prop on the parent
  // chain (page.projectId → screenshot.projectId), but that requires
  // a type change. For now, the simplest correct fix is to look up
  // the projectId from the screenshot's page (the parent
  // <ProjectCard> knows it) and pass it through. To avoid changing
  // ScreenshotWithPins, we pass the projectId as a SECOND optional
  // prop. When absent, the ScreenshotView's presence row has an
  // empty projectId and the route will 400 — better to fail loud
  // than to silently drop the heartbeat.

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

  // === Mouse tracking → cursorRef for usePresence =======================
  // The hook reads `cursorRef.current` on every 5s tick. We translate
  // browser-space event coords into the screenshot's coordinate space
  // (0-100 percent of width/height). The next tick picks up whatever
  // is in the ref at that moment — no per-event throttling needed.
  const cursorRef = useRef<{ x: number | null; y: number | null } | null>(null);
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
    cursorRef.current = { x, y };
  }, []);

  const handleMouseLeave = useCallback(() => {
    cursorRef.current = { x: null, y: null };
  }, []);

  // To attach the ScreenshotView to its project for presence, the
  // parent threads projectId through. The screenshot object itself
  // doesn't carry projectId (it stops at pageId), so the parent
  // <ProjectCard> is responsible for passing it in. When projectId
  // is omitted (e.g. in unit tests), the presence hook is called
  // with an empty projectId which short-circuits the heartbeat
  // (see usePresence) — the recapture flow is the primary use case
  // for ScreenshotView, and presence is the collab-card overlay on
  // top of it.
  // The hook's `others` list is what we render as cursor dots. We
  // intentionally do NOT consume `myUserId` here — the local browser
  // already shows the native cursor, so rendering a self-dot on top
  // would be a duplicate. The hook still tracks self for the
  // (userId, projectId) upsert key on the server.
  const { others } = usePresence({
    projectId: projectId ?? '',
    screenshotId: projectId ? screenshot.id : null,
    cursorRef,
  });

  const handlePinStatusChange = async (pinId: string, status: 'OPEN' | 'RESOLVED') => {
    // Share-link viewers (readOnly) cannot change pin status — the
    // PATCH /api/pins/[id] route requires dashboard origin, but we
    // also short-circuit here so the UI is internally consistent
    // (no optimistic state update that would silently fail).
    if (readOnly) return;
    const res = await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setPins(prev => prev.map(p => p.id === pinId ? { ...p, status } : p));
    }
  };

  const handleCommentAdded = (pinId: string, comment: FeedbackComment) => {
    // The PinThread won't call this in readOnly mode (the form is
    // hidden), but we still no-op here for defense in depth: a
    // future change that wires the form back in shouldn't be able to
    // smuggle state mutations through.
    if (readOnly) return;
    setPins(prev => prev.map(p => p.id === pinId ? { ...p, comments: [...p.comments, comment] } : p));
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
      {pins.map((pin) => (
        <AnnotationGroup
          key={pin.id}
          pin={pin}
          isActive={activePinId === pin.id}
        />
      ))}
    </svg>
  );

  // === Live updates (SSE) =================================================
  // The hook subscribes to /api/events?projectId=X&screenshotId=Y on
  // mount and re-subscribes if either prop changes. We only act on
  // `new-comment` events whose pinId matches a pin we know about —
  // the dispatch is additive (the comment is appended to the local
  // pin state, which is what the active PinThread renders from), so
  // a duplicate from a slow POST roundtrip and a duplicate from the
  // SSE event would both show up. The dedupe key is the comment id
  // (Prisma's UUID); the PinThread is idempotent on id-keyed children.
  //
  // We deliberately do NOT replace the existing recapture poll loop
  // with a `recapture-complete` event listener here — the SSE event
  // is the "fast path" but the polling fallback (which the rest of
  // the dashboard depends on) must remain the source of truth. The
  // useRecaptureStatus hook will pick up the new PNG via either path.
  useLiveEvents({
    projectId: projectId ?? null,
    screenshotId: projectId ? screenshot.id : null,
    onEvent: (event) => {
      if (event.type === 'new-comment') {
        // The payload shape is documented in src/lib/events.ts; the
        // server picks a safe projection (no apiKey, no full pin row).
        const payload = event.payload as {
          pinId: string;
          comment: FeedbackComment;
        };
        // The active pin is the one the reviewer is currently
        // looking at. If the SSE event is for a different pin (a
        // collaborator commenting on a sibling pin), we still
        // optimistically append — the PinThread only opens for
        // the active pin, but the next time it opens, the
        // comment will be there. (This also keeps the pin's
        // comment-count display in sync.)
        if (payload.pinId && payload.comment && payload.comment.id) {
          setPins(prev => prev.map(p =>
            p.id === payload.pinId
              ? (p.comments.some(c => c.id === payload.comment.id)
                  ? p // dedupe: comment already in local state
                  : { ...p, comments: [...p.comments, payload.comment] })
              : p
          ));
        }
      }
    },
  });

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 flex items-center justify-between border-b border-gray-200">
        <div>
          Captured: {new Date(capturedAt).toLocaleString()} · {width}×{height}px
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400">
            {pins.length} pin{pins.length === 1 ? '' : 's'}
          </span>
          <span className="text-gray-400">
            {pins.filter(p => p.status === 'RESOLVED').length} resolved
          </span>
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

      <div
        ref={containerRef}
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
        {pins.map((pin, idx) => {
          const isActive = activePinId === pin.id;
          const isResolved = pin.status === 'RESOLVED';
          return (
            <button
              key={pin.id}
              type="button"
              onClick={() => setActivePinId(isActive ? null : pin.id)}
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
        {others
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
          <div className="absolute top-2 right-2 w-80 max-w-[calc(100%-1rem)] bg-white rounded-lg shadow-2xl border border-gray-200 z-20 max-h-[80vh] overflow-y-auto">
            {(() => {
              const pin = pins.find(p => p.id === activePinId);
              if (!pin) return null;
              return (
                <PinThread
                  pin={pin}
                  projectId={projectId ?? null}
                  readOnly={readOnly}
                  onClose={() => setActivePinId(null)}
                  onStatusChange={handlePinStatusChange}
                  onCommentAdded={handleCommentAdded}
                />
              );
            })()}
          </div>
        )}
      </div>
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
  }, [annotation.id, annotation.path, annotation.pathJson]);
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
