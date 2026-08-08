// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import ProjectNotifications from '@/components/ProjectNotifications';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
let root: Root | null = null;
let container: HTMLDivElement;

const defaults = {
  newPinEmail: false,
  newCommentEmail: false,
  statusChangeEmail: false,
  assignmentEmail: false,
  mentionEmail: true,
};
const recommended = {
  newPinEmail: true,
  newCommentEmail: false,
  statusChangeEmail: true,
  assignmentEmail: true,
  mentionEmail: true,
};

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(selector: string) {
  await act(async () => (container.querySelector(selector) as HTMLButtonElement).click());
  await settle();
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'markup.csrf=notification-csrf; path=/';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe('ProjectNotifications', () => {
  it('loads on demand, applies the role recommendation, and explicitly saves it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        saved: false,
        role: 'owner',
        preferences: defaults,
        recommended,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        saved: true,
        role: 'owner',
        preferences: recommended,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    root = createRoot(container);
    await act(async () => root?.render(<ProjectNotifications projectId="project-1" />));
    expect(fetchMock).not.toHaveBeenCalled();

    await click('[aria-label="Open email notification preferences"]');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/notification-preferences', expect.objectContaining({ headers: expect.any(Object) }));
    expect(container.textContent).toContain('Recommended for agency owners');
    expect((container.querySelector('[aria-label="Email me about new feedback"]') as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector('[aria-label="Email me when I am mentioned"]') as HTMLInputElement).checked).toBe(true);

    await click('[aria-label="Use recommended settings for owner"]');
    expect((container.querySelector('[aria-label="Email me about new feedback"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="Email me about status changes"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="Email me when feedback is assigned to me"]') as HTMLInputElement).checked).toBe(true);

    await click('[aria-label="Save email notification preferences"]');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/project-1/notification-preferences', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify(recommended),
    }));
    expect(container.textContent).toContain('Email preferences saved');
  });

  it('shows an actionable load failure and retries without mounting duplicate requests', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Failed' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        saved: true,
        role: 'client',
        preferences: defaults,
        recommended: { ...recommended, newPinEmail: false, newCommentEmail: true, assignmentEmail: false },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    root = createRoot(container);
    await act(async () => root?.render(<ProjectNotifications projectId="project-1" />));
    await click('[aria-label="Open email notification preferences"]');
    expect(container.textContent).toContain('Could not load email preferences');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await click('[aria-label="Retry loading email notification preferences"]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Recommended for client reviewers');
  });
});
