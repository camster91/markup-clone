// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/LiveEventsProvider', () => ({
  LiveEventsProvider: ({ children }: { children: React.ReactNode }) => children,
  useProjectLiveEvents: vi.fn(),
}));
vi.mock('@/lib/hooks/useRecaptureStatus', () => ({
  useRecaptureStatus: vi.fn(() => ({
    status: null,
    error: null,
    isStale: false,
    start: vi.fn(),
  })),
}));
vi.mock('@/lib/hooks/usePresence', () => ({
  usePresence: vi.fn(() => ({ others: [] })),
  colorForUserId: vi.fn(() => 'bg-blue-500'),
  shortLabelForUserId: vi.fn(() => 'User'),
}));

import PinThread from '@/components/PinThread';
import ScreenshotView from '@/components/ScreenshotView';
import { ShareToggle } from '@/components/ProjectSettings';

let root: Root | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '';
});

describe('PinThread hydration', () => {
  it('hydrates a relative share URL before upgrading it to an absolute copy target', async () => {
    const props = {
      projectId: 'project-1',
      hasShareToken: true,
      shareUrl: '/share/share-token',
      onChange: vi.fn(),
    };
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ShareToggle {...props} />);
    document.body.appendChild(container);
    expect(container.textContent).toContain('/share/share-token');

    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <ShareToggle {...props} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toContain('http://localhost:3000/share/share-token');
  });

  it('keeps share credentials out of screenshot and attachment URLs', () => {
    const screenshotHtml = renderToString(
      <ScreenshotView
        screenshot={{
          id: 'screenshot-1',
          storageKey: 'screenshot-1.png',
          pageId: 'page-1',
          width: 1280,
          height: 800,
          capturedAt: '2026-08-07T15:30:00.000Z',
          pins: [],
        }}
        pagePath="/"
        projectId="project-1"
        readOnly
      />
    );
    expect(screenshotHtml).toContain(
      '/api/screenshots/screenshot-1/image?v=0'
    );

    const threadHtml = renderToString(
      <PinThread
        pin={{
          id: 'pin-1',
          xPercent: 25,
          yPercent: 50,
          status: 'OPEN',
          createdAt: '2026-08-07T15:30:00.000Z',
          comments: [{
            id: 'comment-1',
            text: 'See attachment.',
            author: 'Client',
            authorRole: 'client',
            createdAt: '2026-08-07T15:30:00.000Z',
            attachments: [{
              id: 'attachment-1',
              kind: 'image',
              mimeType: 'image/png',
              size: 123,
              url: '/api/attachments/attachment-1',
            }],
          }],
        }}
        projectId="project-1"
        readOnly
        onClose={vi.fn()}
        onStatusChange={vi.fn()}
        onCommentAdded={vi.fn()}
      />
    );
    expect(threadHtml).toContain(
      '/api/attachments/attachment-1'
    );
    expect(`${screenshotHtml}${threadHtml}`).not.toContain('share=');
  });

  it('renders comment timestamps deterministically across server and browser locales', async () => {
    const localeSpy = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValue('server-formatted-time');
    const props = {
      pin: {
        id: 'pin-1',
        xPercent: 25,
        yPercent: 50,
        status: 'OPEN',
        createdAt: '2026-08-07T15:30:00.000Z',
        comments: [
          {
            id: 'comment-1',
            text: 'Please update this section.',
            author: 'Client',
            authorRole: 'client',
            createdAt: '2026-08-07T15:30:00.000Z',
            attachments: [],
          },
        ],
      },
      projectId: 'project-1',
      readOnly: true,
      onClose: vi.fn(),
      onStatusChange: vi.fn(),
      onCommentAdded: vi.fn(),
    };

    const container = document.createElement('div');
    container.innerHTML = renderToString(<PinThread {...props} />);
    document.body.appendChild(container);

    localeSpy.mockReturnValue('browser-formatted-time');
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <PinThread {...props} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).not.toContain('server-formatted-time');
    expect(container.textContent).not.toContain('browser-formatted-time');
  });

  it('renders screenshot capture times deterministically across server and browser locales', async () => {
    const localeSpy = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValue('server-capture-time');
    const props = {
      screenshot: {
        id: 'screenshot-1',
        storageKey: 'screenshot-1.png',
        pageId: 'page-1',
        width: 1280,
        height: 800,
        capturedAt: '2026-08-07T15:30:00.000Z',
        pins: [],
      },
      pagePath: '/',
      projectId: 'project-1',
      readOnly: true,
    };

    const container = document.createElement('div');
    container.innerHTML = renderToString(<ScreenshotView {...props} />);
    document.body.appendChild(container);

    localeSpy.mockReturnValue('browser-capture-time');
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <ScreenshotView {...props} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).not.toContain('server-capture-time');
    expect(container.textContent).not.toContain('browser-capture-time');
  });
});
