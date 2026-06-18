/* @vitest-environment jsdom */
// Audit D10: DashboardProjects.getTimeSinceUpdate must treat lastUpdated=0 as
// a valid timestamp (not the initial "Updating…" state). The bug was
// `if (!lastUpdated)` which short-circuits on 0 because 0 is falsy. The fix
// is `if (lastUpdated === null)`.
//
// The polling island is now <DashboardPoller>; it owns lastUpdated state.
// The presentational <DashboardProjects> reads the lastUpdated prop and
// runs the same getTimeSinceUpdate logic. We mount <DashboardPoller>
// with initialData and let the mock fetch set lastUpdated to Date.now()
// pinned at 0 — the same edge case the bug fix addresses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import DashboardPoller from '@/components/DashboardPoller';
import type { ProjectWithPages } from '@/lib/types';

// Silence the "current testing environment is not configured to support act(...)"
// warning that React 19 emits when not running inside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Minimal project payload — the component only needs a non-empty list to
// render the timestamp span.
const fakeProjects: ProjectWithPages[] = [
  {
    id: 'proj-1',
    name: 'Test',
    domain: 'example.com',
    apiKey: 'k',
    pages: [],
  } as unknown as ProjectWithPages,
];

describe('DashboardPoller timestamp', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    originalFetch = global.fetch;
    // The polling island calls fetch('/api/projects') on its 5s
    // tick, then sets lastUpdated = Date.now(). We pin Date.now()
    // to 0 so the resulting lastUpdated is 0 — the exact edge
    // case the bug fix addresses. We trigger the fetch manually
    // (the island no longer auto-fetches on mount — the server
    // data is fresh) by calling the first tick ourselves.
    //
    // Implementation note: DashboardPoller's useEffect only sets
    // up the 5s interval — it doesn't call fetchProjects on
    // mount. To exercise the getTimeSinceUpdate "lastUpdated=0"
    // path we need a successful fetch to land. We do that by
    // stubbing fetch and then calling the 5s tick's effect
    // path: the cleanest way is to advance timers. Use
    // vi.useFakeTimers() so we can fast-forward 5s.
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fakeProjects), { status: 200 })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
    dateNowSpy.mockRestore();
    global.fetch = originalFetch;
  });

  it('treats lastUpdated=0 as a valid timestamp (renders a relative time, not "Updating…")', async () => {
    // The polling island's useEffect installs a 5s setInterval
    // that calls fetchProjects (which fetches /api/projects and
    // sets lastUpdated to Date.now()). With Date.now() pinned to
    // 0, the resulting lastUpdated is 0 — the exact edge case
    // the bug fix addresses. We use fake timers + microtask
    // flushing to drive the tick deterministically.
    vi.useFakeTimers();
    try {
      root = createRoot(container);
      await act(async () => {
        root.render(React.createElement(DashboardPoller, { projects: fakeProjects }));
      });
      // The interval is set up after mount. Advance the fake
      // clock past the first 5s tick so fetchProjects() fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      const text = container.textContent ?? '';
      expect(text).not.toContain('Updating…');
      // With Date.now()=0, lastUpdated=0, the math is (0-0)/1000=0s → "Updated just now"
      expect(text).toMatch(/Updated (just now|\d+[smhd] ago)/);
    } finally {
      vi.useRealTimers();
    }
  });
});
