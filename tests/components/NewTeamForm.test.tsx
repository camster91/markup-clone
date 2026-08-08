/* @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewTeamForm from '@/components/NewTeamForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('client account creation form', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'markup.csrf=csrf-value' });
    global.fetch = vi.fn(async () => new Response('{}', { status: 400 })) as typeof fetch;
  });
  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it('uses agency language and sends the dashboard CSRF header', async () => {
    root = createRoot(container);
    await act(async () => root.render(<NewTeamForm workspaceId="agency-1" />));
    expect(container.textContent).toContain('New client account');
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, 'Acme');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/agency-1/teams', expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-value' }),
    }));
  });
});
