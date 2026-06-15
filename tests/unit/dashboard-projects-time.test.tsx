/* @vitest-environment jsdom */
// Audit D10: DashboardProjects.getTimeSinceUpdate must treat lastUpdated=0 as
// a valid timestamp (not the initial "Updating…" state). The bug was
// `if (!lastUpdated)` which short-circuits on 0 because 0 is falsy. The fix
// is `if (lastUpdated === null)`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import DashboardProjects from '@/components/DashboardProjects';
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

describe('DashboardProjects timestamp', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    originalFetch = global.fetch;
    // The component calls fetch('/api/projects') on mount, then sets
    // lastUpdated = Date.now(). We pin Date.now() to 0 so the resulting
    // lastUpdated is 0 — the exact edge case the bug fix addresses.
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
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardProjects));
      // Flush microtasks so the useEffect fetch resolves and
      // setLastUpdated(0) is applied before we read the DOM.
      await new Promise((r) => setTimeout(r, 0));
    });

    const text = container.textContent ?? '';
    expect(text).not.toContain('Updating…');
    // With Date.now()=0, lastUpdated=0, the math is (0-0)/1000=0s → "Updated just now"
    expect(text).toMatch(/Updated (just now|\d+[smhd] ago)/);
  });
});
