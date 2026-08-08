/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IssueMetadataEditor from '@/components/IssueMetadataEditor';
import type { Pin } from '@/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pin: Pin = {
  id: 'pin-1', xPercent: 10, yPercent: 20, status: 'OPEN', priority: 'LOW',
  assignee: null, tags: [{ id: 'tag-1', name: 'QA', key: 'qa' }],
  createdAt: '2026-08-08T00:00:00Z', comments: [], annotations: [],
};
const options = {
  assignees: [{ id: '11111111-1111-4111-8111-111111111111', email: 'dev@example.com' }],
  tags: [{ id: 'tag-1', name: 'QA', key: 'qa' }, { id: 'tag-2', name: 'Frontend', key: 'frontend' }],
};

describe('IssueMetadataEditor', () => {
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

  it('edits priority, assignment, and comma-separated reusable tags in one save', async () => {
    const onSave = vi.fn(async () => undefined);
    await act(async () => root.render(<IssueMetadataEditor pin={pin} options={options} onSave={onSave} />));

    const priority = container.querySelector('select[name="priority"]') as HTMLSelectElement;
    const assignee = container.querySelector('select[name="assigneeId"]') as HTMLSelectElement;
    const tags = container.querySelector('input[name="tagNames"]') as HTMLInputElement;
    await act(async () => {
      priority.value = 'URGENT';
      priority.dispatchEvent(new Event('change', { bubbles: true }));
      assignee.value = options.assignees[0].id;
      assignee.dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(tags, 'QA, Frontend');
      tags.dispatchEvent(new Event('input', { bubbles: true }));
      tags.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save issue details');
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith({
      priority: 'URGENT',
      assigneeId: options.assignees[0].id,
      tagNames: ['QA', 'Frontend'],
    });
    expect(container.textContent).toContain('Issue details saved');
  });

  it('uses accessible native controls and supports clearing assignment and tags', () => {
    act(() => root.render(<IssueMetadataEditor pin={pin} options={options} onSave={vi.fn()} />));
    expect(container.querySelector('fieldset')?.textContent).toContain('Internal issue details');
    expect(container.querySelector('option[value=""]')?.textContent).toContain('Unassigned');
    expect((container.querySelector('input[name="tagNames"]') as HTMLInputElement).getAttribute('maxlength')).toBe('174');
  });
});
