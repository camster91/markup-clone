// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pin } from '@/lib/types';

vi.mock('@/components/LiveEventsProvider', () => ({
  useProjectLiveEvents: vi.fn(),
}));

import PinThread from '@/components/PinThread';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pin: Pin = {
  id: 'pin-1', xPercent: 25, yPercent: 50, status: 'OPEN',
  createdAt: '2026-08-07T12:01:00.000Z', annotations: [],
  developerContext: {
    pageUrl: 'https://example.com/pricing', route: '/pricing',
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    browser: 'Chrome 126', platform: 'Windows', selectors: ['#pricing-cta'],
    elementSnippet: '<button>Start project</button>',
    screenshot: { id: 'shot-1', width: 800, height: 600, capturedAt: '2026-08-07T12:00:00.000Z' },
    reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
  },
  comments: [{
    id: 'comment-1', text: 'Align the CTA', author: 'Client', authorRole: 'client',
    createdAt: '2026-08-07T12:02:00.000Z', attachments: [],
  }],
};

const handoffContext = {
  project: { id: 'project-1', name: 'Acme', domain: 'example.com' },
  pagePath: '/pricing',
  screenshot: { id: 'shot-1', width: 800, height: 600, capturedAt: '2026-08-07T12:00:00.000Z' },
};

describe('PinThread developer handoff', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(showDeveloperContext = true) {
    await act(async () => {
      root.render(
        <PinThread
          pin={pin}
          showDeveloperContext={showDeveloperContext}
          handoffContext={handoffContext}
          onClose={vi.fn()}
          onStatusChange={vi.fn()}
          onCommentAdded={vi.fn()}
        />
      );
    });
  }

  it('copies the canonical Markdown and confirms success', async () => {
    await render();
    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === 'Copy developer handoff');
    expect(button).toBeTruthy();
    expect(container.textContent).toContain('Copies a privacy-safe Markdown issue.');
    await act(async () => button?.click());

    expect(writeText).toHaveBeenCalledOnce();
    const markdown = writeText.mock.calls[0][0] as string;
    expect(markdown).toContain('visual-feedback.issue.v1');
    expect(markdown).toContain('http://localhost:3000/projects/project-1?pin=pin-1');
    expect(markdown).toContain('Align the CTA');
    expect(button?.textContent).toBe('Copied');
  });

  it('surfaces an actionable clipboard failure', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await render();
    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent === 'Copy developer handoff');
    await act(async () => button?.click());

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('Clipboard access failed. Check browser permissions and try again.');
  });

  it('does not mount the handoff action for a reviewer', async () => {
    await render(false);
    expect(container.textContent).not.toContain('Copy developer handoff');
    expect(container.textContent).not.toContain('Developer context');
  });
});
