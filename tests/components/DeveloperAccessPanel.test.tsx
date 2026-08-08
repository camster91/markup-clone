/* @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeveloperAccessPanel from '@/components/DeveloperAccessPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
const token = {
  id: 'token-1', name: 'CI', tokenPrefix: 'mkv1_', tokenLastFour: 'Ab_9', scope: 'issues:read',
  expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: '2026-08-08T00:00:00.000Z',
};

async function settle() {
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('DeveloperAccessPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('creates a read-only token and displays the secret only in the one-time state', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token, secret: `mkv1_${'A'.repeat(43)}` }), { status: 201 }));
    root = createRoot(container);
    await act(async () => root.render(<DeveloperAccessPanel projectId="project-1" />));
    await settle();
    await change(container.querySelector('[aria-label="Token name"]') as HTMLInputElement, 'CI');
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/api-tokens', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'CI', expiresAt: null, scope: 'issues:read' }),
    }));
    expect(container.textContent).toContain('Copy this token now');
    expect((container.querySelector('[aria-label="One-time developer token"]') as HTMLInputElement).value)
      .toMatch(/^mkv1_/);
    expect(container.textContent).toContain('mkv1_••••Ab_9');
  });

  it('lists safe metadata and revokes without ever rendering a hash', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ ...token, tokenHash: 'hidden-hash' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    root = createRoot(container);
    await act(async () => root.render(<DeveloperAccessPanel projectId="project-1" />));
    await settle();
    expect(container.textContent).toContain('CI');
    expect(container.textContent).not.toContain('hidden-hash');
    await act(async () => (container.querySelector('[aria-label="Revoke CI"]') as HTMLButtonElement).click());
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/api-tokens/token-1', expect.objectContaining({ method: 'DELETE' }));
    expect(container.textContent).toContain('Revoked');
  });
});
