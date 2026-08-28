/* @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewWorkspaceForm from '@/components/NewWorkspaceForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('workspace creation form', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'markup.csrf=workspace-csrf',
    });
    global.fetch = vi.fn(async () => new Response('{}', { status: 400 })) as typeof fetch;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it('sends the dashboard CSRF header when creating a workspace', async () => {
    root = createRoot(container);
    await act(async () => root.render(<NewWorkspaceForm />));

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(
        input,
        'QA Workspace'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': 'workspace-csrf' }),
      })
    );
  });
});
