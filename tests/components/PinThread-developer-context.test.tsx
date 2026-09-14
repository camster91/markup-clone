// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/LiveEventsProvider', () => ({
  useProjectLiveEvents: vi.fn(),
}));

import PinThread from '@/components/PinThread';
import type { Pin } from '@/lib/types';

const pin: Pin = {
  id: 'pin-1',
  xPercent: 25,
  yPercent: 50,
  status: 'OPEN',
  elementXPath: '#hero',
  elementHTML: '<button>Buy</button>',
  developerContext: {
    pageUrl: 'https://example.com/pricing',
    route: '/pricing',
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    browser: 'Chrome 126',
    platform: 'Windows',
    selectors: ['#hero', '[data-testid="hero"]'],
    elementSnippet: '<button>Buy</button>',
    screenshot: { id: 'shot-1', width: 2880, height: 1800, capturedAt: '2026-08-07T12:00:00.000Z' },
    reviewRound: { id: 'round-1', number: 2, name: 'Launch review' },
  },
  createdAt: '2026-08-07T12:01:00.000Z',
  comments: [],
  annotations: [],
};

function render(contextPin: Pin, showDeveloperContext: boolean) {
  return renderToString(
    <PinThread
      pin={contextPin}
      showDeveloperContext={showDeveloperContext}
      issueOptions={showDeveloperContext ? {
        assignees: [{ id: 'user-1', email: 'dev@example.com' }],
        tags: [{ id: 'tag-1', name: 'QA', key: 'qa' }],
      } : undefined}
      onClose={vi.fn()}
      onStatusChange={vi.fn()}
      onMetadataChange={vi.fn()}
      onCommentAdded={vi.fn()}
    />
  );
}

describe('PinThread developer context', () => {
  it('renders a collapsed technical packet for an administrator', () => {
    const html = render(pin, true);
    expect(html).toContain('<summary');
    expect(html).toContain('Developer context');
    expect(html).toContain('https://example.com/pricing');
    expect(html).toContain('1440 × 900 @ 2x');
    expect(html).toContain('Chrome 126');
    expect(html).toContain('Launch review');
    expect(html).toContain('#hero');
    expect(html).toContain('&lt;button&gt;Buy&lt;/button&gt;');
  });

  it('explains when an administrator opens a legacy pin without a packet', () => {
    const html = render({ ...pin, developerContext: null }, true);
    expect(html).toContain('Developer context');
    expect(html).toContain('Not captured for this pin.');
  });

  it('does not mount technical context for a reviewer or public viewer', () => {
    const html = render(pin, false);
    expect(html).not.toContain('Developer context');
    expect(html).not.toContain('Chrome 126');
    expect(html).not.toContain('#hero');
    expect(html).not.toContain('&lt;button&gt;Buy&lt;/button&gt;');
    expect(html).not.toContain('Internal issue details');
  });

  it('mounts internal issue editing only for an administrator', () => {
    expect(render({
      ...pin,
      priority: 'HIGH',
      assignee: { id: 'user-1', email: 'dev@example.com' },
      tags: [{ id: 'tag-1', name: 'QA', key: 'qa' }],
    }, true)).toContain('Internal issue details');
  });
});
