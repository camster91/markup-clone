/* @vitest-environment jsdom */
// Integration tests for the dashboard home page's polling client
// island <DashboardPoller>.
//
// The home page is now a React Server Component. The project list
// is fetched server-side and handed to <DashboardPoller> as the
// `projects` prop (the seed for the polling island's useState).
// <DashboardPoller> takes it from there:
//   - On mount, the useEffect installs a 5s setInterval that
//     fetches /api/projects with the existing ?since= delta
//     cursor logic.
//   - The tick is skipped when document.hidden is true (so a
//     backgrounded tab doesn't burn bandwidth).
//   - Each successful fetch updates the projects state and
//     bumps lastUpdated for the "Updated Ns ago" affordance.
//
// This file covers:
//   - The initial render shows the server-rendered initialData
//     (no follow-up fetch on mount).
//   - The 5s tick fetches /api/projects and updates the rendered
//     tree with the new payload.
//   - The 5s tick is skipped when document.hidden is true.
//   - The ?since= cursor is included on the SECOND tick onward
//     (first tick is the full fetch with no cursor).
//   - Failed fetches (non-2xx, network error) don't crash the
//     island and don't drop the rendered tree.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import DashboardPoller from '@/components/DashboardPoller';
import type { ProjectWithPages } from '@/lib/types';

// Silence the "current testing environment is not configured to
// support act(...)" warning that React 19 emits when not running
// inside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeProjectsV1: ProjectWithPages[] = [
  {
    id: 'proj-1',
    name: 'Original',
    domain: 'orig.com',
    apiKey: 'mk_1',
    shareToken: null,
    pages: [],
  } as unknown as ProjectWithPages,
];

const fakeProjectsV2: ProjectWithPages[] = [
  {
    id: 'proj-1',
    name: 'Renamed',
    domain: 'orig.com',
    apiKey: 'mk_1',
    shareToken: null,
    pages: [],
  } as unknown as ProjectWithPages,
  {
    id: 'proj-2',
    name: 'Newly Added',
    domain: 'new.com',
    apiKey: 'mk_2',
    shareToken: null,
    pages: [],
  } as unknown as ProjectWithPages,
];

// Filter the fetch mock down to DashboardPoller's own
// /api/projects calls. Other components in the polling tree
// (usePresence → /api/presence, IntegrationsSection →
// /api/projects/:id/integrations, AuthGate → /api/auth/me)
// make their own fetches independently. The polling island's
// URL is /api/projects (optionally with ?since=...); the
// /api/projects/:id/* sub-routes belong to IntegrationsSection
// and are NOT part of the polling loop.
function projectsPollCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => {
    if (typeof call[0] !== 'string') return false;
    return /^\/api\/projects(\?|$)/.test(call[0]);
  });
}

describe('DashboardPoller — client island', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('renders the server-rendered initialData on mount (no follow-up fetch to /api/projects)', async () => {
    // The RSC hands the initial tree to the polling island.
    // The island should NOT immediately re-fetch /api/projects
    // on mount — the server data IS the first response, and a
    // follow-up fetch would be a wasted request. The first
    // /api/projects fetch fires at the first 5s tick.
    //
    // Note: other components rendered by the polling tree
    // (usePresence, IntegrationsSection, AuthGate) make their
    // own fetches to /api/presence, /api/integrations, /api/auth.
    // We filter on URL — only the /api/projects call from
    // DashboardPoller itself is asserted on.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(fakeProjectsV2), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    // The initial render shows the original project name. The
    // new project from the (mocked) fetch isn't there yet.
    const text = container.textContent ?? '';
    expect(text).toContain('Original');
    expect(text).not.toContain('Newly Added');
    // No /api/projects fetch fired on mount — the server data
    // is the first response, and the polling island skips a
    // redundant request. Other components may have made their
    // own calls (usePresence, AuthGate, IntegrationsSection
    // hitting /api/projects/proj-1/integrations, etc.) — we
    // only assert on the polling island's own /api/projects
    // call (no /:id suffix, optionally with ?since=).
    const projectsCalls = fetchMock.mock.calls.filter((call) => {
      if (typeof call[0] !== 'string') return false;
      // Match /api/projects or /api/projects?... but NOT
      // /api/projects/<id>/integrations or other sub-routes.
      return /^\/api\/projects(\?|$)/.test(call[0]);
    });
    expect(projectsCalls).toHaveLength(0);
  });

  it('polls /api/projects on the 5s tick and updates the rendered tree', async () => {
    // Drive the 5s tick with fake timers. The mocked fetch
    // returns the v2 payload (renamed + new project); after
    // the tick, the rendered tree should show v2.
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fakeProjectsV2), { status: 200 })
    ) as unknown as typeof fetch;

    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    // Before the tick, the original project name is on screen.
    expect(container.textContent ?? '').toContain('Original');

    // Advance the fake clock past the first 5s tick and flush
    // microtasks so the mocked fetch resolves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // The poll fired, the v2 payload landed, the rendered
    // tree shows the rename + the new project.
    const text = container.textContent ?? '';
    expect(text).toContain('Renamed');
    expect(text).toContain('Newly Added');
  });

  it('skips the 5s tick when document.hidden is true', async () => {
    // Backgrounded tabs shouldn't burn bandwidth on a poll
    // the user can't see. The setInterval is still installed
    // (so a foregrounded tab picks up deltas on the next
    // tick), but the tick is gated on document.hidden.
    //
    // Other components (usePresence, IntegrationsSection,
    // AuthGate) make their own fetches independently of the
    // 5s tick — we filter on URL to isolate the polling
    // island's call.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(fakeProjectsV2), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // jsdom defaults document.hidden to false; flip it for
    // the test and restore in afterEach via real timers.
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    // Advance past several 5s ticks. With document.hidden=true
    // the tick is skipped, so the v2 payload never lands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    const projectsCalls = projectsPollCalls(fetchMock);
    expect(projectsCalls).toHaveLength(0);
    // The original tree is still on screen.
    expect(container.textContent ?? '').toContain('Original');
    expect(container.textContent ?? '').not.toContain('Newly Added');

    // Restore the default so other tests aren't affected.
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  it('uses the ?since= cursor on the second tick onward (first tick is the full fetch)', async () => {
    // The /api/projects route accepts ?since=<ISO> for delta
    // polling. The polling island passes `lastSuccessfulPoll
    // - 1000` as the cursor on subsequent ticks; the first
    // tick is the full fetch (no cursor). The 1s overlap is
    // critical: two rows updated in the same millisecond
    // would otherwise race past the cursor and the second
    // one would never come back.
    //
    // Other components make their own fetches independently
    // of the 5s tick — we filter on URL to isolate the
    // polling island's /api/projects calls.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(fakeProjectsV2), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    // First tick: no cursor, full fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    let projectsCalls = projectsPollCalls(fetchMock);
    expect(projectsCalls).toHaveLength(1);
    expect(projectsCalls[0]?.[0]).toBe('/api/projects?view=summary');

    // Second tick: with ?since=<ISO> cursor. The cursor is
    // the last successful poll timestamp - 1000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    projectsCalls = projectsPollCalls(fetchMock);
    expect(projectsCalls).toHaveLength(2);
    const secondUrl = projectsCalls[1]?.[0] as string;
    expect(secondUrl).toMatch(/^\/api\/projects\?view=summary&since=/);
  });

  it('keeps the rendered tree on a non-2xx response (no crash, no drop)', async () => {
    // A transient server error (5xx, 401, etc.) must not
    // clear the rendered tree. The polling island swallows
    // non-2xx responses and keeps showing the previous data.
    const fetchMock = vi.fn(async () =>
      new Response('server error', { status: 500 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // The original tree is still on screen — the 500 didn't
    // clear it.
    expect(container.textContent ?? '').toContain('Original');
  });

  it('keeps the rendered tree on a network error (no crash, no drop)', async () => {
    // A network-level failure (fetch rejects) must not crash
    // the island. The catch swallows the error and the
    // previous data stays on screen.
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(DashboardPoller, { projects: fakeProjectsV1 }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // The original tree is still on screen.
    expect(container.textContent ?? '').toContain('Original');
  });
});
