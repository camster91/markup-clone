/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pin, ProjectWithPages } from '@/lib/types';

vi.mock('@/lib/hooks/usePresence', () => ({ usePresence: () => ({ myUserId: 'owner', others: [] }) }));
vi.mock('@/lib/hooks/useLiveEvents', () => ({ useLiveEvents: () => undefined }));
vi.mock('@/components/LiveEventsProvider', () => ({
  LiveEventsProvider: ({ children }: { children: React.ReactNode }) => children,
  useProjectLiveEvents: () => undefined,
}));
vi.mock('@/components/ScreenshotView', () => ({
  default: ({ screenshot, issueFilters }: { screenshot: { pins: Pin[] }; issueFilters?: import('@/lib/issue-metadata').IssueFilters }) => (
    <div data-testid="visible-pins">{screenshot.pins
      .filter((pin) => !issueFilters
        || ((!issueFilters.status || pin.status === issueFilters.status)
          && (!issueFilters.priority || pin.priority === issueFilters.priority)))
      .map((pin) => pin.id).join(',')}</div>
  ),
}));
vi.mock('@/components/ProjectSettings', () => ({
  default: () => null,
  ShareToggle: () => null,
  IntegrationsSection: () => null,
}));
vi.mock('@/components/ProjectSubscribers', () => ({ default: () => null }));
vi.mock('@/components/ReviewWorkflow', () => ({ default: () => null }));
vi.mock('@/components/PresenceList', () => ({ default: () => null }));

import ProjectDetail from '@/components/ProjectDetail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const basePin = {
  xPercent: 10, yPercent: 20, createdAt: '2026-08-08T00:00:00Z', comments: [], annotations: [],
};
const project: ProjectWithPages = {
  id: 'project-1', name: 'Acme', domain: 'example.com', apiKey: 'mk_key', shareToken: null, canAdmin: true,
  issueOptions: {
    assignees: [{ id: 'user-1', email: 'dev@example.com' }],
    tags: [
      { id: 'tag-1', name: 'Frontend', key: 'frontend' },
      { id: 'tag-2', name: 'QA', key: 'qa' },
    ],
  },
  pages: [{
    id: 'page-1', path: '/', screenshots: [{
      id: 'shot-1', pageId: 'page-1', storageKey: 'shot.png', width: 1000, height: 700,
      capturedAt: '2026-08-08T00:00:00Z',
      pins: [
        { ...basePin, id: 'high-open', status: 'OPEN', priority: 'HIGH', assignee: { id: 'user-1', email: 'dev@example.com' }, tags: [projectTag('tag-1', 'Frontend')] },
        { ...basePin, id: 'high-resolved', status: 'RESOLVED', priority: 'HIGH', assignee: null, tags: [projectTag('tag-2', 'QA')] },
        { ...basePin, id: 'low-open', status: 'OPEN', priority: 'LOW', assignee: null, tags: [projectTag('tag-1', 'Frontend')] },
      ],
    }],
  }],
};

function projectTag(id: string, name: string) {
  return { id, name, key: name.toLowerCase() };
}

describe('ProjectDetail issue filtering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = vi.fn(async () => new Response(JSON.stringify(project), { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('filters screenshot pins with AND semantics and reports the result count', async () => {
    await act(async () => {
      root.render(<ProjectDetail initialProject={project} />);
      await Promise.resolve();
    });
    const priority = container.querySelector('select[name="priority"]') as HTMLSelectElement;
    const status = container.querySelector('select[name="status"]') as HTMLSelectElement;

    act(() => {
      priority.value = 'HIGH';
      priority.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="visible-pins"]')?.textContent).toBe('high-open,high-resolved');

    act(() => {
      status.value = 'OPEN';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="visible-pins"]')?.textContent).toBe('high-open');
    expect(container.textContent).toContain('Showing 1 of 3 issues');
  });

  it('does not mount internal filters for reviewers', async () => {
    const reviewer = { ...project, canAdmin: false, apiKey: null, issueOptions: undefined };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(reviewer), { status: 200 })) as unknown as typeof fetch;
    await act(async () => {
      root.render(<ProjectDetail initialProject={reviewer} />);
      await Promise.resolve();
    });
    expect(container.querySelector('fieldset')).toBeNull();
    expect(container.querySelector('[data-testid="visible-pins"]')?.textContent).toBe('high-open,high-resolved,low-open');
  });
});
