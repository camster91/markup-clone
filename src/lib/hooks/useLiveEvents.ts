'use client';

// useLiveEvents
//
// Client-side hook that subscribes to the server-sent event stream at
// /api/events?projectId=X&screenshotId=Y. The hook opens an EventSource
// and dispatches incoming events to the consumer via a callback. The
// browser's EventSource handles auto-reconnect (the server sends a
// ready event on every successful subscribe so the client knows the
// stream is alive), and the hook's cleanup closes the connection on
// unmount.
//
// Why not just a useEffect that creates EventSource directly in the
// component? Two reasons:
//   1) Cleanup. EventSource.close() must be called on unmount or the
//      connection leaks server-side (the server's pub-sub entry stays
//      around until the server-side req.signal fires, but in a long-
//      lived dev session the leak adds up). Encapsulating the lifecycle
//      in a hook makes the leak impossible.
//   2) ScreenshotId changes. The parent ScreenshotView may be re-keyed
//      when the user switches between screenshots; the screenshotId prop
//      changes accordingly, and the hook should re-subscribe to the
//      new screenshot's stream (or the project-wide stream, if the
//      parent passes null).
//
// IMPORTANT: this hook is ADDITIVE to the existing presence polling
// (F1) and the recapture polling (R0.2). Polling continues to work
// for clients that haven't yet upgraded to the SSE-aware version, and
// the recapture poll loop is still the source of truth for "is the
// new PNG on disk" (SSE is the "fast path" that may or may not arrive
// in time). SSE is a hint, not a contract; consumers must remain
// robust to events that never arrive.

import { useEffect, useRef } from 'react';

export type LiveEventType =
  | 'presence-update'
  | 'new-pin'
  | 'new-comment'
  | 'recapture-complete';

/**
 * The shape of an event as received over the wire. We re-declare it
 * here (not import from src/lib/events.ts) so the client bundle
 * doesn't pull in the server-side pub-sub. The two definitions MUST
 * stay in sync; if you add a new event type, add it to both sides.
 */
export interface LiveEvent {
  type: LiveEventType;
  projectId: string;
  payload: unknown;
}

export interface UseLiveEventsOptions {
  /** The project to subscribe to. Pass '' or null to skip the
   *  subscription (useful when the parent doesn't have a projectId
   *  yet, e.g. a unit test or a not-yet-loaded component). */
  projectId: string | null | undefined;
  /** Optional screenshotId filter. When set, the SSE endpoint is
   *  queried with ?screenshotId=…; the server doesn't actually
   *  filter the events it sends (the client does), but the param
   *  is used server-side for the ready-event echo. */
  screenshotId?: string | null;
  /** Fires for every event the client receives. The hook does not
   *  filter by type — the consumer dispatches on `event.type`. */
  onEvent: (event: LiveEvent) => void;
  /** Optional: fires when the connection is established (the server
   *  sends a `ready` event right after the SSE handshake). Useful for
   *  "connected" UI affordances. */
  onReady?: () => void;
  /** Optional: fires on connection errors. EventSource auto-reconnects,
   *  so this is informational only. */
  onError?: (err: Event) => void;
}

/**
 * useLiveEvents: subscribe to the project's SSE stream.
 *
 * The hook returns nothing — it's a side-effect-only hook. Consumers
 * react to events via the `onEvent` callback.
 *
 * Implementation notes:
 *   - We open the EventSource in a useEffect that depends on projectId
 *     and screenshotId. The browser's EventSource has its own
 *     reconnection logic; on every "open" it issues a new GET, which
 *     re-runs this effect's cleanup + start. This double-fires on
 *     transient disconnects; we keep the effect idempotent (the
 *     cleanup always closes the most recent source) so that's safe.
 *   - We do NOT use the `usePresence` (or any other) polling pattern.
 *     SSE is a separate, additive transport. The presence row is
 *     updated by the existing 5s heartbeat + 5s poll; SSE may ALSO
 *     carry a presence-update event (the route would emit it from
 *     the presence POST), but the polling path remains the source
 *     of truth and F2's swap from polling to SSE for presence is a
 *     separate, future change.
 */
export function useLiveEvents(opts: UseLiveEventsOptions): void {
  const { projectId, screenshotId = null, onEvent, onReady, onError } = opts;

  // Stash the latest callbacks in refs so the effect's dep array
  // stays tight (only projectId + screenshotId). Without this, a
  // parent that re-renders with a fresh closure would tear down +
  // reopen the EventSource on every render — visible in dev as
  // connection blips and 401 floods.
  //
  // We update the refs inside a layout effect (synchronous, before
  // the browser paints) so a render that supplies a new callback
  // has the new value in the ref by the time the SSE handler fires,
  // without putting `.current =` in the render body (which the
  // react-hooks/refs lint rule flags).
  const onEventRef = useRef(onEvent);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onEventRef.current = onEvent;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onEvent, onReady, onError]);

  useEffect(() => {
    // Skip when the parent doesn't have a projectId yet. An empty
    // string is the convention in the rest of the dashboard (see
    // ScreenshotView) to mean "presence is off", so we treat both
    // '' and null/undefined the same.
    if (!projectId) return;

    // Build the SSE URL. EventSource sends cookies + same-origin
    // credentials by default but does NOT set the Origin header on
    // cross-origin streams. The dashboard's auth gate
    // (requireDashboardOrigin) accepts same-origin requests via
    // `sec-fetch-site: same-origin`, and from the dashboard the SSE
    // endpoint is same-origin, so we don't need to inject anything.
    // The dashboardHeaders() helper is for the OTHER endpoints
    // (POST /api/pins, etc.) that the dashboard calls from a worker
    // thread; EventSource is always called from the main window
    // context where the browser handles the headers.
    const params = new URLSearchParams({ projectId });
    if (screenshotId) params.set('screenshotId', screenshotId);
    const url = `/api/events?${params.toString()}`;

    const source = new EventSource(url);

    // The server's first event after the SSE handshake is `ready`
    // (see src/app/api/events/route.ts). We register a dedicated
    // listener so the consumer can render a "connected" indicator
    // without having to dispatch on type from the generic handler.
    source.addEventListener('ready', () => {
      onReadyRef.current?.();
    });

    // Generic event listener for the four event types. EventSource
    // fires one event per `event: <type>\n` line, and the data is
    // a single JSON-encoded payload. We rebuild the typed payload
    // from `e.data` here; the discriminated union on `type` is
    // checked on the consumer side, not here.
    const handler = (e: MessageEvent) => {
      try {
        // Parse defensively. A malformed JSON message would
        // otherwise throw and break the EventSource's listener
        // chain (uncaught errors in event listeners do not stop
        // EventSource, but they pollute the console).
        const data = JSON.parse(typeof e.data === 'string' ? e.data : '{}') as LiveEvent;
        onEventRef.current?.(data);
      } catch {
        // Malformed event — log to console for debugging but
        // don't break the stream.
        console.error('[useLiveEvents] failed to parse event:', e.data);
      }
    };
    source.addEventListener('new-pin', handler);
    source.addEventListener('new-comment', handler);
    source.addEventListener('recapture-complete', handler);
    source.addEventListener('presence-update', handler);

    source.addEventListener('error', (e) => {
      onErrorRef.current?.(e);
    });

    return () => {
      // Cleanup: close the EventSource. The server-side stream
      // will see req.signal fire (EventSource.close() sends a
      // close frame or simply aborts the fetch) and the
      // controller's cancel handler will run, which unsubscribes
      // from the pub-sub and clears the keep-alive ping timer.
      source.close();
    };
  }, [projectId, screenshotId]);
}
