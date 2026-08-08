/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotWithPins } from '@/lib/types';

vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: () => ({ myUserId: 'reviewer-1', others: [] }),
  colorForUserId: () => 'bg-blue-500',
  shortLabelForUserId: () => 'reviewer',
}));
vi.mock('@/lib/hooks/useLiveEvents', () => ({ useLiveEvents: () => undefined }));
vi.mock('@/lib/hooks/useRecaptureStatus', () => ({
  useRecaptureStatus: () => ({
    status: 'idle',
    error: null,
    isStale: false,
    start: vi.fn(),
  }),
}));

import ScreenshotView from '@/components/ScreenshotView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const screenshot: ScreenshotWithPins = {
  id: 'shot-1',
  pageId: 'page-1',
  storageKey: 'shot-1.png',
  width: 1440,
  height: 900,
  capturedAt: '2026-08-07T12:00:00.000Z',
  pins: [{
    id: 'pin-1',
    xPercent: 20,
    yPercent: 30,
    elementXPath: '#hero',
    elementHTML: '<section id="hero">',
    status: 'OPEN',
    createdAt: '2026-08-07T12:00:00.000Z',
    annotations: [],
    comments: [{
      id: 'comment-1',
      author: 'Client',
      authorRole: 'client',
      text: 'Move this heading up',
      attachments: [],
      createdAt: '2026-08-07T12:00:00.000Z',
    }],
  }],
};

describe('ScreenshotView keyboard journey', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/project-1');
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), { status: 200 })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderView(extraProps: Record<string, unknown> = {}) {
    root = createRoot(container);
    await act(async () => {
      root.render(<ScreenshotView screenshot={screenshot} pagePath="/home" projectId="project-1" {...extraProps} />);
    });
  }

  it('implements roving keyboard focus and linked tab panels', async () => {
    await renderView();
    const latest = container.querySelector<HTMLButtonElement>('[data-testid="tab-latest"]');
    const history = container.querySelector<HTMLButtonElement>('[data-testid="tab-history"]');
    expect(latest?.tabIndex).toBe(0);
    expect(history?.tabIndex).toBe(-1);
    expect(latest?.getAttribute('aria-controls')).toBeTruthy();

    latest?.focus();
    await act(async () => {
      latest?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(history?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(history);
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(history?.id);
  });

  it('names pin markers and returns focus after closing a thread with Escape', async () => {
    await renderView();
    const pin = container.querySelector<HTMLButtonElement>('button[aria-label^="Open feedback pin 1"]');
    expect(pin).not.toBeNull();
    pin?.focus();
    await act(async () => pin?.click());

    const thread = container.querySelector<HTMLElement>('[role="dialog"]');
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close comment thread"]');
    expect(thread?.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(close);

    await act(async () => {
      close?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(pin);
  });

  it('opens an exact-pin URL and removes only the pin parameter when closed', async () => {
    window.history.replaceState({}, '', '/projects/project-1?view=latest&pin=pin-1#review');
    await renderView();
    await act(async () => Promise.resolve());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close comment thread"]');
    await act(async () => close?.click());

    expect(window.location.search).toBe('?view=latest');
    expect(window.location.hash).toBe('#review');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('writes the selected pin into the current URL without discarding other state', async () => {
    window.history.replaceState({}, '', '/projects/project-1?view=latest#review');
    await renderView();
    const pinButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Open feedback pin 1"]');
    await act(async () => pinButton?.click());

    expect(window.location.search).toBe('?view=latest&pin=pin-1');
    expect(window.location.hash).toBe('#review');
  });

  it('reports screenshot-relative cursor activity to the project owner', async () => {
    const onPresenceActivity = vi.fn();
    await renderView({ onPresenceActivity });
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    vi.spyOn(panel as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100,
      width: 200, height: 100, toJSON: () => ({}),
    });

    await act(async () => {
      panel?.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 50, clientY: 25,
      }));
    });

    expect(onPresenceActivity).toHaveBeenCalledWith({
      screenshotId: 'shot-1', x: 25, y: 25,
    });
  });

  it('renders only live cursors belonging to this screenshot', async () => {
    await renderView({
      presenceOthers: [
        { id: 'presence-1', userId: 'user-1', projectId: 'project-1', screenshotId: 'shot-1', lastSeenAt: '', cursorX: 20, cursorY: 30 },
        { id: 'presence-2', userId: 'user-2', projectId: 'project-1', screenshotId: 'shot-2', lastSeenAt: '', cursorX: 40, cursorY: 50 },
        { id: 'presence-3', userId: 'user-3', projectId: 'project-1', screenshotId: 'shot-1', lastSeenAt: '', cursorX: null, cursorY: null },
      ],
    });

    const cursors = container.querySelectorAll<HTMLElement>('[data-testid="presence-cursor"]');
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.style.left).toBe('20%');
    expect(cursors[0]?.style.top).toBe('30%');
  });
});
