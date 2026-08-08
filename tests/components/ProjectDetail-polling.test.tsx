/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithPages } from '@/lib/types';

interface PresenceHookOptions {
  projectId: string;
  screenshotId?: string | null;
  activityRef?: unknown;
}
interface LiveEventsHookOptions {
  projectId: string;
  screenshotId?: string | null;
  onEvent?: (event: unknown) => void;
}
const presenceHook = vi.hoisted(() => vi.fn((options: PresenceHookOptions) => {
  void options;
  return { myUserId: 'reviewer-1', others: [] };
}));
const liveEventsHook = vi.hoisted(() => vi.fn((options: LiveEventsHookOptions) => {
  void options;
  return undefined;
}));

vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: presenceHook,
  colorForUserId: () => 'bg-blue-500',
  shortLabelForUserId: () => 'reviewer',
}));
vi.mock('@/lib/hooks/useLiveEvents', () => ({ useLiveEvents: liveEventsHook }));
vi.mock('@/lib/hooks/useRecaptureStatus', () => ({
  useRecaptureStatus: () => ({
    status: 'idle', error: null, isStale: false, start: vi.fn(),
  }),
}));

import ProjectDetail from '@/components/ProjectDetail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: ProjectWithPages = {
  id: 'project-1',
  name: 'Acme',
  domain: 'acme.example',
  apiKey: null,
  shareToken: null,
  canAdmin: false,
  pages: [],
};

describe('ProjectDetail polling boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    presenceHook.mockClear();
    liveEventsHook.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('polls the single-project detail endpoint rather than the summary list', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(project), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    root = createRoot(container);

    await act(async () => {
      root.render(<ProjectDetail initialProject={project} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(calls.some((call) => call[0] === '/api/projects/project-1')).toBe(true);
    expect(calls.some((call) => call[0] === '/api/projects')).toBe(false);
  });

  it('keeps the review visible and offers retry when refresh fails', async () => {
    global.fetch = vi.fn(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch;
    root = createRoot(container);

    await act(async () => {
      root.render(<ProjectDetail initialProject={project} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent ?? '').toContain('Acme');
    expect(container.textContent ?? '').toContain('Live updates paused');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some(
      (button) => button.textContent === 'Retry now'
    )).toBe(true);
  });

  it('hides internal presence identity from client review but keeps it for contributors', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectDetail initialProject={{
        ...project,
        accessRole: 'client',
        reviewBranding: {
          displayName: 'Northstar Studio', logoUrl: null, accentColor: '#facc15',
          accentText: '#111827', welcome: 'Review with us.',
        },
      }} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain('Online now');
    expect(container.textContent).not.toContain('Developer API access');
    expect(container.textContent).toContain('Email notifications');

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectDetail initialProject={{ ...project, canAdmin: true, accessRole: 'contributor' }} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Online now');
    expect(container.textContent).toContain('Developer API access');
    expect(container.textContent).toContain('Email notifications');
  });

  it('owns one collaboration transport regardless of screenshot count', async () => {
    const screenshot = (id: string) => ({
      id,
      pageId: 'page-1',
      storageKey: `${id}.png`,
      width: 1440,
      height: 900,
      capturedAt: '2026-08-08T12:00:00.000Z',
      pins: [],
    });
    const projectWithScreenshots: ProjectWithPages = {
      ...project,
      pages: [{
        id: 'page-1',
        path: '/',
        screenshots: [screenshot('shot-1'), screenshot('shot-2')],
      }],
    };
    global.fetch = vi.fn(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch;
    root = createRoot(container);

    await act(async () => {
      root.render(<ProjectDetail initialProject={projectWithScreenshots} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const presenceBindings = new Set(presenceHook.mock.calls.map(([options]) =>
      `${options.projectId}:${options.screenshotId ?? 'project'}:${Boolean(options.activityRef)}`
    ));
    const eventBindings = new Set(liveEventsHook.mock.calls.map(([options]) =>
      `${options.projectId}:${options.screenshotId ?? 'project'}`
    ));
    expect([...presenceBindings]).toEqual(['project-1:project:true']);
    expect([...eventBindings]).toEqual(['project-1:project']);
  });

  it('coalesces live-event refreshes while a project request is in flight', async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(project), { status: 200 }))
      .mockImplementation(() => pendingRefresh);
    global.fetch = fetchMock as unknown as typeof fetch;
    root = createRoot(container);

    await act(async () => {
      root.render(<ProjectDetail initialProject={project} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fetchMock.mockClear();
    const onEvent = liveEventsHook.mock.calls.at(-1)?.[0]?.onEvent as ((event: unknown) => void) | undefined;
    expect(onEvent).toBeTypeOf('function');

    await act(async () => {
      onEvent?.({ type: 'new-pin', projectId: project.id, payload: {} });
      onEvent?.({ type: 'new-comment', projectId: project.id, payload: {} });
      await Promise.resolve();
    });

    const detailCalls = fetchMock.mock.calls.filter(([input]) => input === '/api/projects/project-1');
    expect(detailCalls).toHaveLength(1);
    await act(async () => {
      resolveRefresh?.(new Response(JSON.stringify(project), { status: 200 }));
      await pendingRefresh;
    });
  });
});
