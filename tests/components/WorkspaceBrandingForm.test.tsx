// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import WorkspaceBrandingForm from '@/components/WorkspaceBrandingForm';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const fetchMock = vi.fn();

async function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'workspace-1' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'markup.csrf=branding-csrf; path=/';
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('WorkspaceBrandingForm', () => {
  it('previews and saves the bounded workspace identity', async () => {
    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<WorkspaceBrandingForm workspaceId="workspace-1" initialBranding={{
        brandName: null, logoUrl: null, accentColor: null, reviewerWelcome: null,
      }} />);
    });

    await change(container.querySelector('[aria-label="Reviewer-facing brand name"]')!, 'Northstar Studio');
    await change(container.querySelector('[aria-label="Logo URL"]')!, 'https://cdn.example.com/logo.png');
    await change(container.querySelector('[aria-label="Brand accent color"]')!, '#4f46e5');
    await change(container.querySelector('[aria-label="Reviewer welcome message"]')!, 'Review the latest build with us.');
    expect(container.textContent).toContain('Northstar Studio');
    expect(container.textContent).toContain('Review the latest build with us.');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/logo.png');

    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        brandName: 'Northstar Studio', logoUrl: 'https://cdn.example.com/logo.png',
        accentColor: '#4f46e5', reviewerWelcome: 'Review the latest build with us.',
      }),
    }));
    expect(container.textContent).toContain('Branding saved');
  });
});
