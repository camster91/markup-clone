/* @vitest-environment jsdom */
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import IssueFilters from '@/components/IssueFilters';
import type { IssueFilters as IssueFilterValue } from '@/lib/issue-metadata';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = {
  assignees: [{ id: 'user-1', email: 'dev@example.com' }],
  tags: [{ id: 'tag-1', name: 'Front End', key: 'front end' }],
};

function Harness() {
  const [value, setValue] = useState<IssueFilterValue>({});
  return <IssueFilters value={value} options={options} matched={2} total={4} onChange={setValue} />;
}

describe('IssueFilters', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers native, labelled agency filters with useful empty-state context', () => {
    act(() => root.render(<Harness />));

    expect(container.querySelector('fieldset')?.textContent).toContain('Filter issues');
    const labels = Array.from(container.querySelectorAll('label')).map((label) => label.textContent ?? '');
    expect(['Status', 'Priority', 'Assignee', 'Tag'].every(
      (name) => labels.some((label) => label.startsWith(name))
    )).toBe(true);
    expect(container.textContent).toContain('Showing 2 of 4 issues');
    expect(container.textContent).toContain('dev@example.com');
    expect(container.textContent).toContain('Front End');
  });

  it('updates one filter without dropping the others and clears them all', () => {
    act(() => root.render(<Harness />));
    const selects = container.querySelectorAll('select');

    act(() => {
      selects[0].value = 'OPEN';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      selects[1].value = 'HIGH';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((container.querySelector('select[name="status"]') as HTMLSelectElement).value).toBe('OPEN');
    expect((container.querySelector('select[name="priority"]') as HTMLSelectElement).value).toBe('HIGH');

    const clear = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Clear filters');
    act(() => clear?.click());
    expect((container.querySelector('select[name="status"]') as HTMLSelectElement).value).toBe('');
    expect((container.querySelector('select[name="priority"]') as HTMLSelectElement).value).toBe('');
  });
});
