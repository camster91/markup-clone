'use client';

// useRecaptureStatus
//
// Extracted from <ScreenshotView> (R0.2 refactor) so the recapture state
// machine + poll loop can be unit-tested in isolation without a DOM.
//
// The hook owns:
//   - the recapture status state machine: idle → starting → running →
//     done / error (unchanged from the previous in-component version).
//   - the 'stillRendering' flag (audit D11) that flips on at i=30 to swap
//     the recapture button label from "Capturing…" to "Still rendering…"
//     during the 90s timeout.
//   - the mountedRef abort-on-unmount guard (audit F5) that bails out of
//     the 90-tick poll loop if the component unmounts mid-flight.
//   - the 3s auto-clear setTimeout that returns the button to 'idle'
//     after 'done'. Audit rows for recapture are written by the
//     server route (POST /api/screenshots/[id]/recapture) — the
//     client must NOT call audit() (that helper is a server-side
//     prisma write and would either no-op or leak an unintended
//     client→DB path).
//
// The screenshot is *re-captured* server-side via
//   POST /api/screenshots/[id]/recapture
// (which fires off the bind-mount chromium script as a detached child
// and immediately returns 200 with {"status":"started"}). We then poll
//   GET /api/screenshots/[id]/status?since=<lastCapturedAt>
// once a second for up to 90 ticks. The ?since= short-circuit returns
// 304 Not Modified when nothing has changed, so we don't pay the cost of
// the JSON body until the new PNG actually lands.
//
// When the status response carries new width/height, the hook calls the
// caller-provided `onUpdate` callback (if any) so the owning component
// can update its img src cache-buster + the visible dim readout. The
// hook itself deliberately does NOT own width/height/capturedAt state —
// those are display concerns that belong to the component, and pushing
// them into the hook would couple it to the ScreenshotView's render
// shape.
//
// Auth: the recapture and status endpoints both gate on the dashboard
// origin via `requireDashboardOrigin()`. The browser sets Origin
// automatically on same-origin fetches; the dashboard header helper
// (dashboardHeaders()) injects the explicit Origin for cases where the
// browser would otherwise omit it (e.g. some cross-origin embed
// scenarios). We attach the same dashboard header to both calls so a
// future embedder wiring this hook from outside the dashboard still
// gets the right auth signal.

import { useState, useRef, useCallback, useEffect } from 'react';
import { dashboardHeaders } from '@/lib/client-origin';

export type RecaptureStatus = 'idle' | 'starting' | 'running' | 'done' | 'error';

export interface UseRecaptureStatusResult {
  status: RecaptureStatus;
  error: string | null;
  isStale: boolean;
  start: () => Promise<void>;
}

export interface ScreenshotDims {
  width: number;
  height: number;
  capturedAt: string;
}

export interface UseRecaptureStatusOptions {
  /**
   * Called when the status poll detects a width/height change. The
   * owning component typically uses this to bump its image cache-buster
   * key and update the dim readout. Optional — when omitted, the hook
   * still drives the status state machine but does not surface the new
   * dims (useful for tests that only care about the state transitions).
   */
  onUpdate?: (dims: ScreenshotDims) => void;
  /**
   * Initial dims so the poll loop knows what "changed" means. The hook
   * treats any response where the new width OR height differs from
   * these values as a successful recapture.
   */
  initial?: ScreenshotDims;
}

// Audit D11: poll-loop bounds. The 90-tick × 1s cap (= 90s) is the
// hard upper bound; the 30-tick mark is where we flip `isStale` to true
// so the UI can swap the button label to "Still rendering…".
const POLL_TICK_MS = 1000;
const POLL_MAX_TICKS = 90;
const STILL_RENDERING_TICK = 30;
const DONE_AUTO_CLEAR_MS = 3000;

export function useRecaptureStatus(
  screenshotId: string,
  options: UseRecaptureStatusOptions = {}
): UseRecaptureStatusResult {
  const { onUpdate, initial } = options;

  const [status, setStatus] = useState<RecaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Audit D11: flips on once the poll loop has been running for 30s.
  // Drives the "Still rendering…" button label so the operator can tell
  // the operation is still in flight during the 90s timeout. Independent
  // of `status` (which follows the idle → starting → running → done/error
  // state machine).
  const [isStale, setIsStale] = useState<boolean>(false);

  // Audit F5: mounted flag so the poll loop can bail out if the
  // component unmounts (or the user navigates away) while a 90-tick
  // poll is still in flight. Without this, setState would fire on an
  // unmounted component (React warning + memory leak), and the final
  // setTimeout(..., 3000) auto-clear would too. We use a ref rather
  // than useState because reads are synchronous inside async callbacks
  // and we don't want a re-render when the flag flips.
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    setIsStale(false);
    try {
      const res = await fetch(`/api/screenshots/${screenshotId}/recapture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...dashboardHeaders(),
        },
        body: '{}',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        const message = (data as { error?: string }).error || `HTTP ${res.status}`;
        throw new Error(message);
      }
      setStatus('running');
      // Poll for the new screenshot. The bound is 90 ticks × 1s = 90s
      // (raised from 30 in audit D11 because real-world recaptures of
      // large pages under the headless Chromium pipeline can legitimately
      // take 40-60s to land). We pass ?since=<lastCapturedAt> so the
      // status endpoint can short-circuit with 304 Not Modified when
      // nothing has changed yet — saving the JSON body until the
      // recapture actually lands. Once capturedAt is bumped, the next
      // poll returns 200 with the new dims and we break out early.
      let updated = false;
      let lastSince = initial?.capturedAt ?? '';
      for (let i = 0; i < POLL_MAX_TICKS; i++) {
        await new Promise((r) => setTimeout(r, POLL_TICK_MS));
        // Bail out of the poll loop if the component unmounted during
        // the 1s sleep. Without this, the rest of the loop body would
        // call setStatus / setError on an unmounted component.
        if (!mountedRef.current) return;
        // At i=30 (30s in) flip the button label to "Still rendering…"
        // so the operator knows the operation is still in flight. The
        // poll itself keeps going up to i=90.
        if (i === STILL_RENDERING_TICK && mountedRef.current) {
          setIsStale(true);
        }
        try {
          const r2 = await fetch(
            `/api/screenshots/${screenshotId}/status?since=${encodeURIComponent(lastSince)}`,
            {
              cache: 'no-store',
              headers: dashboardHeaders(),
            }
          );
          if (r2.status === 200) {
            const data = (await r2.json()) as ScreenshotDims;
            const dimsChanged =
              !initial ||
              data.width !== initial.width ||
              data.height !== initial.height;
            if (dimsChanged) {
              lastSince = data.capturedAt;
              onUpdate?.(data);
              updated = true;
              break;
            }
            // 200 but unchanged (shouldn't normally happen with ?since=,
            // but be defensive) — keep the latest capturedAt in hand.
            if (data.capturedAt) lastSince = data.capturedAt;
          }
          // 304: nothing has changed yet, keep polling.
        } catch {
          // Network blip on a single tick — keep polling.
        }
      }
      if (!mountedRef.current) return;
      setStatus(updated ? 'done' : 'error');
      setIsStale(false);
      if (!updated) {
        setError('Timed out waiting for the new screenshot');
      } else {
        // Auto-clear the "done" indicator after 3 seconds.
        setTimeout(() => {
          if (mountedRef.current) setStatus('idle');
        }, DONE_AUTO_CLEAR_MS);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Recapture failed');
    }
  }, [screenshotId, onUpdate, initial]);

  return { status, error, isStale, start };
}
