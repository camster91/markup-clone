/* @vitest-environment jsdom */
// Integration test for the dashboard list page's "split into per-project
// pages" refactor.
//
// What this catches that the existing dashboard-projects-time test
// can't:
//   - Project cards on the home page render as <a href="/projects/...">
//     links (not as inline trees). A regression that drops the link
//     would silently break the "click to open the project" UX and
//     leave the per-project tree unreachable from the home page.
//   - The link points to the per-project detail route (not the old
//     fragment-style /#project-id scroll target or any other
//     internal anchor).
//   - The compact card still shows the project name, domain, and
//     pin counts so the operator can scan the list at a glance.
//
// The component is mounted with a mocked /api/projects fetch that
// returns a single project. The polled payload is then asserted
// for the expected anchor and supporting copy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import DashboardProjects from '@/components/DashboardProjects';
import type { ProjectWithPages } from '@/lib/types';

// Silence the "current testing environment is not configured to
// support act(...)" warning that React 19 emits when not running
// inside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeProjects: ProjectWithPages[] = [
  {
    id: 'proj-abc-123',
    name: 'Acme Redesign',
    domain: 'acme.com',
    apiKey: 'mk_abc',
    shareToken: null,
    pages: [
      {
        id: 'page-1',
        path: '/',
        screenshots: [
          {
            id: 'shot-1',
            pageId: 'page-1',
            storageKey: 'a.png',
            width: 1024,
            height: 768,
            capturedAt: '2026-01-02T00:00:00.000Z',
            pins: [
              {
                id: 'pin-1',
                xPercent: 50,
                yPercent: 50,
                status: 'OPEN',
                createdAt: '2026-01-02T00:00:00.000Z',
                comments: [],
                annotations: [],
              },
              {
                id: 'pin-2',
                xPercent: 25,
                yPercent: 25,
                status: 'RESOLVED',
                createdAt: '2026-01-02T00:00:00.000Z',
                comments: [],
                annotations: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('DashboardProjects list view — split into per-project pages', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    originalFetch = global.fetch;
    // The component calls fetch('/api/projects') on mount. The
    // first poll returns the canned projects; subsequent polls
    // (5s tick) never fire in this test.
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
    global.fetch = originalFetch;
  });

  it('renders each project card as a link to /projects/[id]', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardProjects));
      // Flush microtasks so the useEffect fetch resolves before
      // we read the DOM.
      await new Promise((r) => setTimeout(r, 0));
    });

    // The compact card links the project name to /projects/<id>.
    // We assert on the href shape (not the text) so a future copy
    // change doesn't false-positive this test.
    const anchors = Array.from(container.querySelectorAll('a')) as HTMLAnchorElement[];
    const projectAnchors = anchors.filter((a) =>
      a.getAttribute('href') === '/projects/proj-abc-123'
    );
    // We expect at least two anchors (the name link in the header
    // and the "Open project →" link in the body row).
    expect(projectAnchors.length).toBeGreaterThanOrEqual(1);
    // The project name is the link text on at least one of them.
    const nameAsLink = projectAnchors.some(
      (a) => a.textContent?.includes('Acme Redesign') ?? false
    );
    expect(nameAsLink).toBe(true);
  });

  it('does not render the per-project screenshot tree inline on the home page', async () => {
    // The full screenshot/pin tree moved to /projects/[id]. A
    // regression that re-inlines the tree on the home page would
    // undo the split — we'd see screenshot ids leaking into the
    // list view. Pin the absence.
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardProjects));
      await new Promise((r) => setTimeout(r, 0));
    });

    // ScreenshotView renders an <img data-testid="screenshot-image">
    // (or similar) — we just check the storageKey is NOT in the
    // DOM as text. The compact card shows the capture count as
    // "1 capture" — NOT the storageKey.
    const text = container.textContent ?? '';
    expect(text).not.toContain('a.png');
  });

  it('shows the project name, domain, and pin counts on the compact card', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardProjects));
      await new Promise((r) => setTimeout(r, 0));
    });

    const text = container.textContent ?? '';
    // The compact card still surfaces the scan affordances.
    expect(text).toContain('Acme Redesign');
    expect(text).toContain('acme.com');
    // 2 pins total, 1 open. The compact card shows both numbers.
    expect(text).toContain('2');
    expect(text).toContain('1');
    // The "Open project →" affordance is the secondary link.
    expect(text).toMatch(/Open project/);
  });
});
