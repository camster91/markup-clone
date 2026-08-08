'use client';

import { useEffect, useId, useState } from 'react';
import type { IssueOptions, Pin } from '@/lib/types';
import { ISSUE_PRIORITIES, type IssuePriority } from '@/lib/issue-metadata';

export type IssueMetadataUpdate = {
  priority: IssuePriority;
  assigneeId: string | null;
  tagNames: string[];
};

export default function IssueMetadataEditor({
  pin,
  options,
  onSave,
}: {
  pin: Pin;
  options: IssueOptions;
  onSave: (update: IssueMetadataUpdate) => Promise<void>;
}) {
  const [priority, setPriority] = useState<IssuePriority>(pin.priority ?? 'NONE');
  const [assigneeId, setAssigneeId] = useState(pin.assignee?.id ?? '');
  const [tagNames, setTagNames] = useState((pin.tags ?? []).map((tag) => tag.name).join(', '));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const listId = useId();

  useEffect(() => {
    setPriority(pin.priority ?? 'NONE');
    setAssigneeId(pin.assignee?.id ?? '');
    setTagNames((pin.tags ?? []).map((tag) => tag.name).join(', '));
    setState('idle');
  }, [pin.id, pin.priority, pin.assignee?.id, pin.tags]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state === 'saving') return;
    setState('saving');
    try {
      await onSave({
        priority,
        assigneeId: assigneeId || null,
        tagNames: tagNames.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <form onSubmit={submit} className="mb-4">
      <fieldset className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
        <legend className="px-1 text-xs font-semibold text-indigo-950">Internal issue details</legend>
        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs font-medium text-gray-700">
            Priority
            <select
              name="priority"
              value={priority}
              onChange={(event) => { setPriority(event.target.value as IssuePriority); setState('idle'); }}
              className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              {ISSUE_PRIORITIES.map((value) => (
                <option key={value} value={value}>{value === 'NONE' ? 'No priority' : value.charAt(0) + value.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700">
            Assignee
            <select
              name="assigneeId"
              value={assigneeId}
              onChange={(event) => { setAssigneeId(event.target.value); setState('idle'); }}
              className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">Unassigned</option>
              {options.assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>{assignee.email}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700">
            Tags
            <input
              name="tagNames"
              list={listId}
              value={tagNames}
              maxLength={174}
              onChange={(event) => { setTagNames(event.target.value); setState('idle'); }}
              placeholder="QA, Frontend"
              className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            />
            <span className="mt-1 block font-normal text-gray-500">Up to 5 tags, separated by commas.</span>
          </label>
          <datalist id={listId}>
            {options.tags.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state === 'saving'}
            className="min-h-11 rounded-md bg-indigo-700 px-3 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-60"
          >
            {state === 'saving' ? 'Saving…' : 'Save issue details'}
          </button>
          {state === 'saved' ? <p role="status" className="text-xs font-medium text-green-700">Issue details saved</p> : null}
          {state === 'error' ? <p role="alert" className="text-xs font-medium text-red-700">Could not save issue details. Try again.</p> : null}
        </div>
      </fieldset>
    </form>
  );
}
