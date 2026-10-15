// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import ProjectSubscribers from '@/components/ProjectSubscribers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectSubscribers loading', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await act(async () => {
      root.render(<ProjectSubscribers projectId="project-1" />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.fetch = originalFetch;
  });

  const toggle = () =>
    act(async () => {
      (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click();
    });

  it('shows an error (not "No subscribers yet") when the load fails, and Retry recovers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await toggle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Failed to load subscribers (HTTP 500)');
    expect(container.textContent).not.toContain('No subscribers yet');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(['a@example.com']), { status: 200 }));
    await act(async () => {
      (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Retry') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('a@example.com');
  });

  it('re-fetches each time the panel is opened instead of keeping a stale list', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    await toggle();
    expect(container.textContent).toContain('No subscribers yet');

    await toggle(); // collapse
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ subscribers: ['a@example.com'] }), { status: 200 }));
    await toggle(); // expand
    expect(container.textContent).toContain('a@example.com');

    await toggle(); // collapse
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(['a@example.com', 'b@example.com']), { status: 200 }));
    await toggle(); // expand: a non-empty list is refreshed too

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('b@example.com');
  });

  it('ignores a slow older load that resolves after a newer one', async () => {
    let resolveOld: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveOld = r; }));
    await toggle(); // expand: load 1 stays pending
    await toggle(); // collapse
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(['new@example.com']), { status: 200 }));
    await toggle(); // expand: load 2 resolves
    expect(container.textContent).toContain('new@example.com');

    await act(async () => {
      resolveOld(new Response(JSON.stringify(['stale@example.com']), { status: 200 }));
    });
    expect(container.textContent).toContain('new@example.com');
    expect(container.textContent).not.toContain('stale@example.com');
  });
});
