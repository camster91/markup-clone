// @vitest-environment jsdom
//
// ScreenshotView used to copy `screenshot.pins` into state once
// (`useState(screenshot.pins)`) and never look at the prop again, so the
// parent's 5s poll / SSE refreshes never reached the screenshot. It now
// derives pins from the prop and layers its own confirmed edits on top
// for a short window so a stale in-flight poll can't revert them.

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { Pin, ScreenshotWithPins } from '@/lib/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/hooks/useRecaptureStatus', () => ({
  useRecaptureStatus: vi.fn(() => ({ status: 'idle', error: null, isStale: false, start: vi.fn() })),
}));
vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: vi.fn(() => ({ others: [] })),
  colorForUserId: vi.fn(() => 'bg-blue-500'),
  shortLabelForUserId: vi.fn(() => 'User'),
}));
// A minimal thread that exposes the status callback ScreenshotView wires up.
vi.mock('@/components/PinThread', async () => {
  const React = await import('react');
  return {
    default: ({ pin, onStatusChange }: { pin: Pin; onStatusChange: (id: string, s: 'OPEN' | 'RESOLVED') => Promise<void> }) =>
      React.createElement(
        'button',
        { type: 'button', 'data-testid': 'resolve', onClick: () => void onStatusChange(pin.id, 'RESOLVED') },
        `thread ${pin.id} ${pin.status}`
      ),
  };
});

import ScreenshotView from '@/components/ScreenshotView';

function pin(id: string, status: 'OPEN' | 'RESOLVED' = 'OPEN', text = `comment ${id}`): Pin {
  return {
    id,
    xPercent: 10,
    yPercent: 20,
    status,
    createdAt: '2026-10-01T00:00:00.000Z',
    comments: [{ id: `c-${id}`, text, author: 'Client', authorRole: 'client', createdAt: '2026-10-01T00:00:00.000Z', attachments: [] }],
    annotations: [],
  };
}

function shot(pins: Pin[]): ScreenshotWithPins {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    storageKey: 's.png',
    pageId: 'page-1',
    width: 1280,
    height: 720,
    capturedAt: '2026-10-01T00:00:00.000Z',
    pins,
  };
}

function pinLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[aria-label*="feedback pin"]'))
    .map((b) => b.getAttribute('aria-label') ?? '');
}

describe('ScreenshotView pin sync', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const render = (screenshot: ScreenshotWithPins) =>
    act(async () => {
      root.render(<ScreenshotView screenshot={screenshot} pagePath="/" projectId="project-1" />);
    });

  it('picks up pins added and changed by a parent refresh', async () => {
    await render(shot([pin('a')]));
    expect(pinLabels(container)).toEqual(['Open feedback pin 1: comment a']);

    await render(shot([pin('a', 'RESOLVED'), pin('b')]));
    expect(pinLabels(container)).toEqual([
      'Resolved feedback pin 1: comment a',
      'Open feedback pin 2: comment b',
    ]);

    await render(shot([pin('b')]));
    expect(pinLabels(container)).toEqual(['Open feedback pin 1: comment b']);
  });

  it('keeps a confirmed local edit over a stale refresh, then defers to the server once it expires', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await render(shot([pin('a')]));

    // Open the thread and resolve the pin (PATCH succeeds).
    await act(async () => {
      (container.querySelector('button[aria-label^="Open feedback pin 1"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="resolve"]') as HTMLButtonElement).click();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/pins/a', expect.objectContaining({ method: 'PATCH' }));
    expect(pinLabels(container)[0]).toMatch(/^Resolved/);

    // A poll that started before the PATCH landed still says OPEN, but it
    // does carry a new pin from someone else.
    now += 2_000;
    await render(shot([pin('a', 'OPEN'), pin('b')]));
    expect(pinLabels(container)).toEqual([
      'Resolved feedback pin 1: comment a',
      'Open feedback pin 2: comment b',
    ]);

    // Well past the patch window the server copy wins again (e.g. a
    // teammate reopened the pin).
    now += 60_000;
    await render(shot([pin('a', 'OPEN'), pin('b')]));
    expect(pinLabels(container)[0]).toMatch(/^Open/);
  });
});
