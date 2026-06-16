/* @vitest-environment jsdom */
// Unit tests for src/lib/hooks/useRecaptureStatus.ts.
//
// The hook encapsulates the recapture state machine + poll loop that
// was previously inlined in <ScreenshotView>. These tests exercise the
// hook in isolation using a minimal renderHook helper built on
// react-dom/client.createRoot + React.act — the same pattern the
// other jsdom tests in this repo (dashboard-projects-time.test.tsx,
// screenshot-view-recapture.test.tsx) use. We don't pull in
// @testing-library/react because the existing test convention in this
// repo is to drive hooks/components via createRoot + act directly.
//
// Time control: we use vi.useFakeTimers() + vi.advanceTimersByTimeAsync
// so the hook's `await new Promise(r => setTimeout(r, 1000))` sleeps
// can be driven tick-by-tick in microseconds. That gives us
// deterministic control over what state the hook is in at every loop
// iteration — including the i=30 setIsStale(true) flip, which we
// need to observe mid-flight. The 3s auto-clear timer is also a
// fake setTimeout, so we explicitly don't advance past it in the
// success test to keep the terminal 'done' state observable.
//
// What we cover:
//   1. Initial state is idle / null / false.
//   2. start() transitions: starting → running, then done on 200-with-
//      new-dims from the status poll.
//   3. The 90s timeout sets status=error when the status poll never
//      reports new dims.
//   4. isStale flips to true at the 30-tick mark and resets to false
//      at the terminal error branch.
//   5. Unmount aborts the poll loop: setState on an unmounted component
//      would fire a React warning, which we surface as a test failure
//      via vi.spyOn(console, 'error').
//
// We also assert that the hook emits audit entries on the success /
// failure / spawn-error transitions, since the task body explicitly
// requires "audit-log emission on success/failure/spawn_error must
// still happen (call audit() from the hook, not the component)".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import { useRecaptureStatus, type UseRecaptureStatusResult } from '@/lib/hooks/useRecaptureStatus';

// Silence the "current testing environment is not configured to support act(...)"
// warning that React 19 emits when not running inside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

const SCREENSHOT_ID = '11111111-1111-1111-1111-111111111111';
const INITIAL_CAPTURED_AT = '2026-06-14T15:00:00.000Z';
const NEW_CAPTURED_AT = '2026-06-14T15:01:00.000Z';

function makeFetchMock(opts: {
  recaptureStatus?: number;
  statusSequence?: Array<{ status: number; body?: unknown }>;
  defaultRecaptureBody?: unknown;
}): typeof fetch {
  const statusIter = (opts.statusSequence ?? [])[Symbol.iterator]();
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (u.includes('/recapture')) {
      const body = opts.defaultRecaptureBody ?? { success: true, data: { screenshotId: SCREENSHOT_ID, status: 'started' } };
      return new Response(JSON.stringify(body), {
        status: opts.recaptureStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/status')) {
      const next = statusIter.next();
      if (!next.done) {
        const { status, body } = next.value;
        if (status === 304) return new Response(null, { status: 304 });
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Out of responses — default to "unchanged" 200 with the initial
      // dims so the loop never sees a dim change and times out.
      return new Response(
        JSON.stringify({ width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

// Render the hook and capture its return value on every render.
//
// The pattern: a Test component calls the hook, then a useEffect
// mirrors (hook, hook.start) into closure-scoped holders the test
// reads from. The observations list records every (status, isStale)
// pair the hook produced, so tests can assert on the full history of
// state transitions (e.g. isStale flipping to true at i=30, then
// back to false at the terminal branch).
//
// We deliberately avoid the "ref assignment during render" pattern
// (which the react-hooks/refs lint rule explicitly blocks) and the
// "useState-as-render-ref" pattern (which is also discouraged). The
// useEffect-mirror approach satisfies the React purity rules AND
// gives the test synchronous access to the latest hook state.
//
// This is the same pattern the existing tests in this repo
// (dashboard-projects-time.test.tsx,
// screenshot-view-recapture.test.tsx) use to drive components from a
// test harness.
function mountHookWithStart(
  options?: { onUpdate?: (dims: { width: number; height: number; capturedAt: string }) => void; initial?: { width: number; height: number; capturedAt: string } }
): { current: UseRecaptureStatusResult; unmount: () => void; observations: Array<{ status: string; isStale: boolean }>; start: () => Promise<void> } {
  const observations: Array<{ status: string; isStale: boolean }> = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const startHolder: { current: (() => Promise<void>) | null } = { current: null };
  const latestHolder: { current: UseRecaptureStatusResult | null } = { current: null };
  const Test = () => {
    const hook = useRecaptureStatus(SCREENSHOT_ID, options);
    // The useEffect runs AFTER the render commits, so it's the
    // correct place to side-channel the hook state out to the
    // test. The dep array is empty (we always want the latest
    // hook from the most recent render to be captured), so the
    // effect re-runs on every commit.
    React.useEffect(() => {
      latestHolder.current = hook;
      startHolder.current = hook.start;
      observations.push({ status: hook.status, isStale: hook.isStale });
    });
    return null;
  };
  act(() => {
    root.render(React.createElement(Test));
  });
  return {
    get current() {
      if (!latestHolder.current) throw new Error('hook did not render');
      return latestHolder.current;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    observations,
    get start() {
      if (!startHolder.current) throw new Error('hook did not render');
      return startHolder.current;
    },
  };
}

describe('useRecaptureStatus', () => {
  let originalFetch: typeof global.fetch;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mocks.audit.mockReset();
    // Capture any "setState on unmounted" warnings or other React
    // errors so we can fail the test on the abort-on-unmount assertion.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('returns idle / null / false on first render', () => {
    global.fetch = makeFetchMock({});
    const hook = mountHookWithStart();
    try {
      expect(hook.current.status).toBe('idle');
      expect(hook.current.error).toBeNull();
      expect(hook.current.isStale).toBe(false);
      expect(typeof hook.current.start).toBe('function');
    } finally {
      hook.unmount();
    }
  });

  it('start() transitions to starting then running, and done on a 200 with new dims', async () => {
    const onUpdate = vi.fn();
    // Status poll returns 304s for two ticks, then the new dims on the
    // third tick. The hook should fire onUpdate and break out.
    global.fetch = makeFetchMock({
      statusSequence: [
        { status: 304 }, // tick 0: nothing yet
        { status: 200, body: { width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT } }, // tick 1: unchanged
        { status: 200, body: { width: 1281, height: 721, capturedAt: NEW_CAPTURED_AT } }, // tick 2: changed → break
      ],
    });

    vi.useFakeTimers();
    const hook = mountHookWithStart({
      onUpdate,
      initial: { width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT },
    });
    try {
      let startPromise: Promise<void> = Promise.resolve();
      await act(async () => {
        startPromise = hook.start();
        // Recapture POST resolves on the next microtask. advanceTimersByTimeAsync(0)
        // flushes microtasks so the fetch resolves and the loop flips to 'running'.
        await vi.advanceTimersByTimeAsync(0);
      });
      // After the POST resolves, status flips to 'running' and the loop
      // is about to take its first 1s sleep.
      expect(hook.current.status).toBe('running');

      // Drive the loop tick by tick. We need exactly 3 iterations to
      // consume the queued status responses (304, 200-unchanged, 200-new).
      // After the 3rd tick, onUpdate fires and the loop breaks out.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      await act(async () => {
        await startPromise;
      });

      // Loop exited with updated=true. We assert before any additional
      // timer advance so the 3s auto-clear hasn't fired (it's also a
      // fake setTimeout, so any extra advance would revert to 'idle').
      expect(hook.current.status).toBe('done');
      expect(hook.current.error).toBeNull();
      expect(onUpdate).toHaveBeenCalledWith({
        width: 1281,
        height: 721,
        capturedAt: NEW_CAPTURED_AT,
      });
      // Success audit entry fired.
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'screenshot.recapture',
          target: SCREENSHOT_ID,
          metadata: expect.objectContaining({ status: 'ok' }),
        })
      );
    } finally {
      hook.unmount();
    }
  });

  it('a timeout (90 polls × 1s) sets status=error', async () => {
    // Every status poll returns the SAME dims, so the loop never
    // breaks early. After 90 ticks the loop exits and the hook sets
    // status=error with the timeout message.
    global.fetch = makeFetchMock({});

    vi.useFakeTimers();
    const hook = mountHookWithStart({
      initial: { width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT },
    });
    try {
      let startPromise: Promise<void> = Promise.resolve();
      await act(async () => {
        startPromise = hook.start();
        await vi.advanceTimersByTimeAsync(0);
      });
      // Drive 90 ticks of 1000ms each.
      for (let i = 0; i < 90; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      await act(async () => {
        await startPromise;
      });

      expect(hook.current.status).toBe('error');
      expect(hook.current.error).toMatch(/Timed out/i);
      expect(hook.current.isStale).toBe(false);
      // No success audit on timeout.
      const okCall = mocks.audit.mock.calls.find(
        (c) => (c[0] as { metadata?: { status?: string } }).metadata?.status === 'ok'
      );
      expect(okCall).toBeUndefined();
    } finally {
      hook.unmount();
    }
  });

  it('isStale flips to true at the 30s mark and back to false after error', async () => {
    // Status poll returns 304s forever so the loop runs the full 90
    // ticks. With per-tick timer control we can stop at i=30 and
    // observe the isStale transition directly.
    global.fetch = makeFetchMock({});

    vi.useFakeTimers();
    const hook = mountHookWithStart({
      initial: { width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT },
    });
    try {
      let startPromise: Promise<void> = Promise.resolve();
      await act(async () => {
        startPromise = hook.start();
        await vi.advanceTimersByTimeAsync(0);
      });
      // Run 30 ticks. At i===30 inside the loop body, setIsStale(true)
      // fires. We advance one tick past the 30-tick setState so the
      // setState has been committed before we read it.
      for (let i = 0; i < 31; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(hook.current.isStale).toBe(true);
      // Status is still 'running' (we haven't hit the 90s cap yet).
      expect(hook.current.status).toBe('running');

      // Run out the rest of the loop (60 more ticks) to reach the
      // terminal state. isStale resets to false in the terminal branch.
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      await act(async () => {
        await startPromise;
      });

      expect(hook.current.status).toBe('error');
      expect(hook.current.isStale).toBe(false);
    } finally {
      hook.unmount();
    }
  });

  it('unmount aborts the poll loop (no setState on unmounted component)', async () => {
    // The poll loop awaits setTimeout(r, 1000) then checks mountedRef.
    // On unmount the mountedRef flips to false and the loop bails out
    // before any further setState. If the abort-on-unmount guard
    // regressed, we'd see the React "setState on unmounted" warning
    // fire from console.error.
    global.fetch = makeFetchMock({});

    vi.useFakeTimers();
    const hook = mountHookWithStart({
      initial: { width: 1280, height: 720, capturedAt: INITIAL_CAPTURED_AT },
    });

    let startPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      startPromise = hook.start();
      // Recapture POST resolves and the loop flips to 'running'.
      await vi.advanceTimersByTimeAsync(0);
    });
    // Take ONE loop tick so the loop is in the middle of its sleep,
    // then unmount. The next tick's mountedRef check should bail.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    hook.unmount();
    // Drive time well past the 90s cap. With the abort guard, the
    // loop bails on the very next tick; without it, the loop would
    // call setStatus('error') on an unmounted component.
    for (let i = 0; i < 95; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    await act(async () => {
      await startPromise.catch(() => {
        // start() can reject if an internal step throws after unmount;
        // that's fine for this test — we only care about the
        // setState-on-unmounted warning.
      });
    });

    // The crucial assertion: no React "set state on an unmounted
    // component" warning fired. The console.error spy captured all
    // console.error calls; filter for that specific warning string.
    const setStateWarnings = consoleErrorSpy.mock.calls.filter((c) => {
      const first = String(c[0] ?? '');
      return /setstate.*unmounted|unmounted.*component|can't perform a react state update/i.test(first);
    });
    expect(setStateWarnings).toEqual([]);
  });

  it('records an audit entry on spawn_error when the recapture POST fails', async () => {
    global.fetch = makeFetchMock({
      recaptureStatus: 500,
      defaultRecaptureBody: { error: 'spawn exploded' },
    });

    const hook = mountHookWithStart();
    try {
      await act(async () => {
        await hook.start();
      });

      // The setStatus('error') fires inside the awaited start()
      // call. The Test component's useEffect mirrors hook state into
      // latestHolder on commit; one more microtask flush is enough
      // to make the mirrored state visible to the test reader.
      expect(hook.observations.some((o) => o.status === 'error')).toBe(true);
      const lastErrorObservation = [...hook.observations].reverse().find((o) => o.status === 'error');
      expect(lastErrorObservation).toBeDefined();
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'screenshot.recapture',
          target: SCREENSHOT_ID,
          metadata: expect.objectContaining({ status: 'spawn_error' }),
        })
      );
    } finally {
      hook.unmount();
    }
  });
});
