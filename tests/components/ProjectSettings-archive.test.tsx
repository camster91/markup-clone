/* @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectSettings from '@/components/ProjectSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectSettings archive controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'site-1' }), { status: 200 })) as typeof fetch;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('uses reversible archive instead of permanent delete for an active site', async () => {
    const updated = vi.fn();
    root = createRoot(container);
    await act(async () => root.render(
      <ProjectSettings projectId="site-1" projectName="Acme" archivedAt={null} onProjectUpdated={updated} />,
    ));
    await act(async () => (container.querySelector('[aria-label="Site settings"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Archive site');
    expect(container.textContent).not.toContain('Delete Project');
    const archive = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Archive site'))!;
    await act(async () => archive.click());
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/site-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ archived: true }),
    }));
    expect(updated).toHaveBeenCalled();
  });

  it('offers restore for an archived site', async () => {
    root = createRoot(container);
    await act(async () => root.render(
      <ProjectSettings projectId="site-1" projectName="Acme" archivedAt="2026-08-08T12:00:00.000Z" onProjectUpdated={() => {}} />,
    ));
    await act(async () => (container.querySelector('[aria-label="Site settings"]') as HTMLButtonElement).click());
    const restore = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Restore site'))!;
    await act(async () => restore.click());
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/site-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ archived: false }),
    }));
  });
});
