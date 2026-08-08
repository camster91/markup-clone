/* @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ArchivedSites from '@/components/ArchivedSites';
import type { ProjectSummary } from '@/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const archived: ProjectSummary[] = [{
  id: 'site-1', name: 'Acme redesign', domain: 'acme.example', archivedAt: '2026-08-08T12:00:00.000Z',
  apiKey: 'must-not-render', shareToken: null, canAdmin: true, teamId: 'client-1',
  team: { id: 'client-1', name: 'Acme' }, createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z', totalPages: 3, totalScreenshots: 5, totalPins: 8, openPins: 2,
}];

describe('ArchivedSites', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it('renders a compact historical site card without live or secret-bearing controls', async () => {
    root = createRoot(container);
    await act(async () => root.render(<ArchivedSites projects={archived} />));
    expect(container.textContent).toContain('Acme redesign');
    expect(container.textContent).toContain('Client: Acme');
    expect(container.textContent).toContain('Archived');
    expect(container.textContent).toContain('Restore site');
    expect(container.textContent).not.toContain('must-not-render');
    expect(container.textContent).not.toContain('Public share link');
    expect(container.textContent).not.toContain('Outbound integrations');
    expect(container.textContent).not.toContain('Online now');
  });
});
