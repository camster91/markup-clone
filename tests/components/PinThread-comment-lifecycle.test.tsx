// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/useLiveEvents', () => ({ useLiveEvents: vi.fn() }));

import PinThread from '@/components/PinThread';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const comment = {
  id: 'comment-1',
  text: 'Please make the headline stronger.',
  author: 'Client',
  authorRole: 'client',
  createdAt: '2026-08-09T12:00:00.000Z',
  attachments: [],
};

describe('PinThread comment lifecycle controls', () => {
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

  async function render(overrides: Partial<React.ComponentProps<typeof PinThread>> = {}) {
    await act(async () => {
      root.render(
        <PinThread
          pin={{
            id: 'pin-1', xPercent: 25, yPercent: 50, status: 'OPEN',
            createdAt: '2026-08-09T12:00:00.000Z', comments: [comment], annotations: [],
          }}
          canManageComments
          onClose={vi.fn()}
          onStatusChange={vi.fn()}
          onCommentAdded={vi.fn()}
          onCommentUpdated={vi.fn().mockResolvedValue({ ...comment, text: 'Updated headline request.' })}
          onCommentDeleted={vi.fn().mockResolvedValue(true)}
          {...overrides}
        />,
      );
    });
  }

  it('lets an administrator edit a comment and updates the visible thread after saving', async () => {
    const onCommentUpdated = vi.fn().mockResolvedValue({ ...comment, text: 'Updated headline request.' });
    await render({ onCommentUpdated });

    const edit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Edit comment');
    await act(async () => edit?.click());
    const editor = container.querySelector('textarea[aria-label="Edit comment by Client"]') as HTMLTextAreaElement;
    expect(editor.value).toBe(comment.text);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(editor, 'Updated headline request.');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save edit');
    await act(async () => save?.click());

    expect(onCommentUpdated).toHaveBeenCalledWith('pin-1', 'comment-1', 'Updated headline request.');
    expect(container.textContent).toContain('Updated headline request.');
  });

  it('requires an explicit confirmation before deleting a comment', async () => {
    const onCommentDeleted = vi.fn().mockResolvedValue(true);
    await render({ onCommentDeleted });

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Delete comment');
    await act(async () => deleteButton?.click());
    expect(container.textContent).toContain('This cannot be undone.');
    expect(onCommentDeleted).not.toHaveBeenCalled();

    const confirm = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Confirm delete');
    await act(async () => confirm?.click());

    expect(onCommentDeleted).toHaveBeenCalledWith('pin-1', 'comment-1');
    expect(container.textContent).not.toContain(comment.text);
  });

  it('does not show comment controls to a reviewer or a public share viewer', async () => {
    await render({ canManageComments: false });
    expect(container.textContent).not.toContain('Edit comment');
    expect(container.textContent).not.toContain('Delete comment');

    await render({ readOnly: true });
    expect(container.textContent).not.toContain('Edit comment');
    expect(container.textContent).not.toContain('Delete comment');
  });
});
