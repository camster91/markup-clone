// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import TeamAccessManager from '@/components/TeamAccessManager';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('TeamAccessManager', () => {
  it('creates a project-scoped guest invitation and shows its link once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({
          invitation: {
            id: 'invite-new', email: 'guest@example.com', role: 'guest',
            project: { id: 'project-1', name: 'Client site' },
            expiresAt: '2026-08-15T00:00:00.000Z', acceptedAt: null, revokedAt: null,
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          acceptUrl: 'https://markup.example/invite#token-one-time',
        }, 201);
      }
      return json([]);
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeamAccessManager
          workspaceId="workspace-1"
          teamId="team-1"
          projects={[{ id: 'project-1', name: 'Client site' }]}
          members={[]}
        />,
      );
    });
    await settle();

    expect(container.textContent).toContain('Contributor');
    expect(container.textContent).toContain('Client');
    expect(container.textContent).toContain('Guest');

    await change(container.querySelector('[aria-label="Invitation email"]')!, 'guest@example.com');
    await change(container.querySelector('[aria-label="Invitation role"]')!, 'guest');
    await change(container.querySelector('[aria-label="Guest project"]')!, 'project-1');
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await settle();

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(createCall?.[1]?.body as string)).toEqual({
      email: 'guest@example.com', role: 'guest', projectId: 'project-1',
    });
    expect(container.textContent).toContain('Copy this invitation link now');
    expect(container.textContent).toContain('It will not be shown again');
    expect((container.querySelector('[aria-label="One-time invitation link"]') as HTMLInputElement).value)
      .toBe('https://markup.example/invite#token-one-time');
  });

  it('revokes pending invitations and updates or removes current members', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/invitations/invite-1') && init?.method === 'DELETE') {
        return json({ revoked: true });
      }
      if (url.includes('/members/member-2') && init?.method === 'PATCH') {
        return json({ id: 'member-2', role: 'client', projectId: null });
      }
      if (url.includes('/members/member-2') && init?.method === 'DELETE') {
        return json({ deleted: true });
      }
      return json([{
        id: 'invite-1', email: 'pending@example.com', role: 'client', project: null,
        expiresAt: '2026-08-15T00:00:00.000Z', acceptedAt: null, revokedAt: null,
        createdAt: '2026-08-08T00:00:00.000Z',
      }]);
    });

    const container = document.getElementById('root')!;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeamAccessManager
          workspaceId="workspace-1"
          teamId="team-1"
          projects={[{ id: 'project-1', name: 'Client site' }]}
          members={[
            { id: 'member-1', email: 'owner@example.com', role: 'owner', projectId: null },
            { id: 'member-2', email: 'dev@example.com', role: 'contributor', projectId: null },
          ]}
        />,
      );
    });
    await settle();

    expect(container.textContent).toContain('pending@example.com');
    const revoke = container.querySelector('[aria-label="Revoke invitation for pending@example.com"]') as HTMLButtonElement;
    await act(async () => revoke.click());
    await settle();
    expect(container.textContent).not.toContain('pending@example.com');

    const role = container.querySelector('[aria-label="Role for dev@example.com"]') as HTMLSelectElement;
    await change(role, 'client');
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/teams/team-1/members/member-2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'client' }) }),
    );

    const remove = container.querySelector('[aria-label="Remove dev@example.com"]') as HTMLButtonElement;
    await act(async () => remove.click());
    await settle();
    expect(container.textContent).not.toContain('dev@example.com');
  });
});
