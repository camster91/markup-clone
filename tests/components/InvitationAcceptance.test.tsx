// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import InvitationAcceptance from '@/components/InvitationAcceptance';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
let root: Root | null = null;
const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', `/invite#${token}`);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('InvitationAcceptance', () => {
  it('clears the fragment before inspection and never renders the token', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    fetchMock.mockImplementation(async () => {
      expect(window.location.hash).toBe('');
      return json({
        email: 'client@example.com', role: 'client', expiresAt: '2026-08-15T00:00:00.000Z',
        workspace: {
          id: 'workspace-1', name: 'Agency', brandName: 'Northstar Studio',
          logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#4f46e5',
          reviewerWelcome: 'Review the latest build with us.',
        },
        team: { id: 'team-1', name: 'Website review' }, project: null,
      });
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<InvitationAcceptance />);
    });
    await settle();

    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/invite');
    expect(container.textContent).toContain('Website review');
    expect(container.textContent).toContain('Client access');
    expect(container.textContent).toContain('Northstar Studio');
    expect(container.textContent).toContain('Review the latest build with us.');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    expect(container.textContent).not.toContain(token);
    expect(container.innerHTML).not.toContain(token);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invitations/inspect',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token }) }),
    );
  });

  it('accepts with a password that can sign in or create the invited account', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/accept')) {
        return json({ accepted: true, redirectTo: '/workspaces/workspace-1/teams/team-1' });
      }
      return json({
        email: 'dev@example.com', role: 'contributor', expiresAt: '2026-08-15T00:00:00.000Z',
        workspace: { id: 'workspace-1', name: 'Agency' },
        team: { id: 'team-1', name: 'Build team' }, project: null,
      });
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<InvitationAcceptance />);
    });
    await settle();
    expect(container.textContent).toContain('If you already have an account, enter its password');

    const password = container.querySelector('[aria-label="Account password"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(password, 'securepassword123');
      password.dispatchEvent(new Event('input', { bubbles: true }));
      password.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invitations/accept',
      expect.objectContaining({
        method: 'POST', body: JSON.stringify({ token, password: 'securepassword123' }),
      }),
    );
    expect(container.textContent).toContain('Invitation accepted');
    expect(container.innerHTML).not.toContain(token);
  });

  it('shows a generic recovery message for an invalid or expired invitation', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Invitation unavailable' }, 404));
    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(<InvitationAcceptance />);
    });
    await settle();
    expect(container.textContent).toContain('This invitation is unavailable');
    expect(container.textContent).toContain('Ask the team owner for a new invitation');
  });
});
