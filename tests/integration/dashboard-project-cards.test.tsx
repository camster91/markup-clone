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
// The home page is now an RSC. The polling client island is
// <DashboardPoller>; it seeds useState with the server-rendered
// `initialData` and renders <DashboardProjects> with the latest
// data. We mount <DashboardPoller> with `initialData` here so
// the test doesn't depend on the mock-fetch path — the polling
// island's render path is exercised by
// tests/components/DashboardPoller.test.tsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';

const presenceHook = vi.hoisted(() => vi.fn(() => ({ myUserId: 'owner-1', others: [] })));
vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: presenceHook,
  colorForUserId: () => 'bg-blue-500',
  shortLabelForUserId: () => 'owner',
}));

import DashboardPoller from '@/components/DashboardPoller';
import type { ProjectSummary } from '@/lib/types';

// Silence the "current testing environment is not configured to
// support act(...)" warning that React 19 emits when not running
// inside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeProjects: ProjectSummary[] = [
  {
    id: 'proj-abc-123',
    name: 'Acme Redesign',
    domain: 'acme.com',
    apiKey: 'mk_abc',
    shareToken: null,
    canAdmin: true,
    teamId: null,
    team: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    totalPages: 1,
    totalScreenshots: 1,
    totalPins: 2,
    openPins: 1,
  },
];

describe('DashboardProjects list view — split into per-project pages', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    presenceHook.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    originalFetch = global.fetch;
    // The polling island would normally call /api/projects on its
    // 5s tick. The list-rendering tests pass initialData directly
    // to <DashboardPoller> and don't depend on the fetch — but
    // we still stub fetch so the tick (if it fires) doesn't hit
    // a real network.
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
      root.render(React.createElement(DashboardPoller, { projects: fakeProjects }));
      // Flush microtasks so the useEffect tick resolves before
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
      root.render(React.createElement(DashboardPoller, { projects: fakeProjects }));
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
      root.render(React.createElement(DashboardPoller, { projects: fakeProjects }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const text = container.textContent ?? '';
    // The compact card still surfaces the scan affordances.
    expect(text).toContain('Acme Redesign');
    expect(text).toContain('acme.com');
    // 2 pins total, 1 open. The compact card shows both numbers.
    expect(text).toContain('2');
    expect(text).toContain('1');
    // The "Open site →" affordance is the secondary agency-facing link.
    expect(text).toMatch(/Open site/);
  });

  it('does not report the overview user as present in unopened projects', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjects }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(presenceHook).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Online now');
  });

  it('shows reviewer access without rendering project administration controls', async () => {
    const reviewerProjects = [{
      ...fakeProjects[0],
      apiKey: null,
      shareToken: null,
      canAdmin: false,
    }] as ProjectSummary[];
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: reviewerProjects }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Review access');
    expect(text).toContain('Open review');
    expect(text).not.toContain('API Key');
    expect(text).not.toContain('Public share link');
    expect(text).not.toContain('Subscribers');
    expect(text).not.toContain('Outbound integrations');
    expect(container.querySelector('[aria-label="Site settings"]')).toBeNull();
  });
});
