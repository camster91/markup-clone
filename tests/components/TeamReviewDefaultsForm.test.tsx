/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamReviewDefaultsForm from '@/components/TeamReviewDefaultsForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TeamReviewDefaultsForm', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('saves the reusable numbered template and pause preference', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'team-1' }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    root = createRoot(container);
    await act(async () => {
      root.render(<TeamReviewDefaultsForm
        workspaceId="workspace-1"
        teamId="team-1"
        reviewRoundNameTemplate="Review round {n}"
        reviewRoundCommentsPaused={false}
      />);
    });
    const template = container.querySelector<HTMLInputElement>('[aria-label="Review round name template"]')!;
    const paused = container.querySelector<HTMLInputElement>('[aria-label="Start new rounds paused"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(template, 'Sprint {n} QA');
      template.dispatchEvent(new Event('input', { bubbles: true }));
      paused.click();
      container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/workspace-1/teams/team-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ reviewRoundNameTemplate: 'Sprint {n} QA', reviewRoundCommentsPaused: true }),
    }));
    expect(container.textContent).toContain('Review defaults saved');
  });
});
