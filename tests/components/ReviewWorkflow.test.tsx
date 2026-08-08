/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReviewWorkflow from '@/components/ReviewWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const activeRound = {
  id: 'round-1',
  number: 1,
  name: 'Launch review',
  status: 'IN_REVIEW',
  commentsPaused: false,
  isActive: true,
  pinCount: 3,
  signOffs: [],
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
};

describe('ReviewWorkflow', () => {
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

  async function renderWith(payload: unknown) {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
    root = createRoot(container);
    await act(async () => {
      root.render(<ReviewWorkflow projectId="project-1" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('shows the active round and reviewer sign-off without mounting admin controls', async () => {
    await renderWith({ activeReviewRoundId: 'round-1', canAdmin: false, callerUserId: 'user-1', rounds: [activeRound] });
    expect(container.textContent).toContain('Launch review');
    expect(container.textContent).toContain('In review');
    expect(container.textContent).toContain('Sign off');
    expect(container.textContent).not.toContain('Pause new feedback');
    expect(container.querySelector('select')).toBeNull();
  });

  it('explains that replies remain open when new feedback is paused', async () => {
    await renderWith({ activeReviewRoundId: 'round-1', canAdmin: false, callerUserId: 'user-1', rounds: [{ ...activeRound, commentsPaused: true }] });
    expect(container.textContent).toContain('New pins are paused; replies remain open.');
  });

  it('offers round creation only to administrators in the empty state', async () => {
    await renderWith({
      activeReviewRoundId: null,
      canAdmin: true,
      callerUserId: 'owner-1',
      defaults: { suggestedName: 'Sprint 4 QA', commentsPaused: true },
      rounds: [],
    });
    expect(container.textContent).toContain('Start first review round');
    expect(container.querySelector<HTMLInputElement>('input[name="roundName"]')?.value).toBe('Sprint 4 QA');
    expect(container.textContent).toContain('New rounds start with new feedback paused');
  });

  it('shows an actionable retry after loading fails', async () => {
    global.fetch = vi.fn(async () => new Response('bad', { status: 503 })) as unknown as typeof fetch;
    root = createRoot(container);
    await act(async () => {
      root.render(<ReviewWorkflow projectId="project-1" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Retry');
  });
});
