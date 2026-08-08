/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryPanel from '@/components/HistoryPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const version = {
  id: 'version-1',
  capturedAt: '2026-08-07T12:00:00.000Z',
  width: 1440,
  height: 900,
  storageKey: 'version-1.png',
  createdBy: 'reviewer-1',
};

describe('HistoryPanel keyboard and recovery behavior', () => {
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

  async function renderWith(fetchImpl: typeof fetch) {
    global.fetch = fetchImpl;
    root = createRoot(container);
    await act(async () => {
      root.render(<HistoryPanel screenshotId="shot-1" refreshKey={0} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('focuses the dialog, closes on Escape, and returns focus to the thumbnail', async () => {
    await renderWith(vi.fn(async () =>
      new Response(JSON.stringify({ versions: [version] }), { status: 200 })
    ) as unknown as typeof fetch);

    const thumb = container.querySelector<HTMLButtonElement>('[data-testid="history-thumb-version-1"]');
    expect(thumb).not.toBeNull();
    thumb?.focus();
    await act(async () => thumb?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const close = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Close'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(close);

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(thumb);
  });

  it('offers a retry after a failed history request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ versions: [version] }), { status: 200 }));
    await renderWith(fetchMock as unknown as typeof fetch);

    expect(container.textContent ?? '').toContain('Failed to load history');
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Retry history'
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="history-thumb-version-1"]')).not.toBeNull();
  });
});
