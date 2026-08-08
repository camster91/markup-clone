/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from '@/lib/hooks/usePresence';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function PresenceHarness({
  activityRef,
}: {
  activityRef: React.MutableRefObject<{
    screenshotId: string;
    x: number | null;
    y: number | null;
  } | null>;
}) {
  usePresence({ projectId: 'project-1', activityRef });
  return null;
}

describe('usePresence project-owned activity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('reads the focused screenshot and cursor from the shared activity ref', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      if (input === '/api/auth/me') {
        return new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 });
      }
      if (typeof input === 'string' && input.startsWith('/api/presence?')) {
        return new Response(JSON.stringify({ presences: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ presence: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const activityRef = {
      current: { screenshotId: 'shot-2', x: 25, y: 75 },
    };
    root = createRoot(container);

    await act(async () => {
      root.render(<PresenceHarness activityRef={activityRef} />);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const heartbeat = calls.find(([input, init]) => input === '/api/presence' && init?.method === 'POST');
    expect(heartbeat).toBeDefined();
    expect(JSON.parse(String(heartbeat?.[1]?.body))).toMatchObject({
      projectId: 'project-1',
      screenshotId: 'shot-2',
      cursorX: 25,
      cursorY: 75,
    });
  });
});
