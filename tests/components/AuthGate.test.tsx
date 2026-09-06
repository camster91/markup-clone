/* @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/LoginForm', () => ({
  default: function LoginFormMock() {
    return <div data-testid="login-form">Login form</div>;
  },
}));
vi.mock('@/components/LogoutButton', () => ({
  default: function LogoutButtonMock() {
    return <button type="button">Sign out</button>;
  },
}));

import AuthGate from '@/components/AuthGate';

describe('AuthGate offline vs anonymous', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows LoginForm on 401 (anonymous), not the offline banner', async () => {
    const onChange = vi.fn();
    global.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;

    await act(async () => {
      root.render(<AuthGate onChange={onChange} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="login-form"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Can't reach the server");
    expect(onChange).toHaveBeenCalledWith('anonymous', null);
  });

  it('shows offline banner + Retry on network failure, not LoginForm', async () => {
    const onChange = vi.fn();
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await act(async () => {
      root.render(<AuthGate onChange={onChange} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="login-form"]')).toBeNull();
    expect(container.textContent).toContain("Can't reach the server");
    expect(container.querySelector('button')?.textContent).toBe('Retry');
    expect(onChange).toHaveBeenCalledWith('offline', null);
  });

  it('Retry re-fetches /api/auth/me', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'u1', email: 'a@b.co', role: 'operator' },
      }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => {
      root.render(<AuthGate />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Can't reach the server");
    const retry = container.querySelector('button');
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/auth/me')).toBe(true);
    expect(container.textContent).toContain('a@b.co');
  });
});
