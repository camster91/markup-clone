'use client';

import type { IssueOptions } from '@/lib/types';
import { ISSUE_PRIORITIES, UNASSIGNED_FILTER, type IssueFilters as IssueFilterValue } from '@/lib/issue-metadata';

export default function IssueFilters({
  value,
  options,
  matched,
  total,
  onChange,
}: {
  value: IssueFilterValue;
  options: IssueOptions;
  matched: number;
  total: number;
  onChange: (value: IssueFilterValue) => void;
}) {
  const set = (key: keyof IssueFilterValue, next: string) => {
    const valueWithoutEmpty = { ...value, [key]: next || undefined };
    onChange(valueWithoutEmpty);
  };

  return (
    <fieldset className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <legend className="px-1 text-sm font-semibold text-gray-800">Filter issues</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-medium text-gray-700">
          Status
          <select
            name="status"
            value={value.status ?? ''}
            onChange={(event) => set('status', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700">
          Priority
          <select
            name="priority"
            value={value.priority ?? ''}
            onChange={(event) => set('priority', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="">All priorities</option>
            {ISSUE_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{priority === 'NONE' ? 'No priority' : titleCase(priority)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700">
          Assignee
          <select
            name="assigneeId"
            value={value.assigneeId ?? ''}
            onChange={(event) => set('assigneeId', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="">All assignees</option>
            <option value={UNASSIGNED_FILTER}>Unassigned</option>
            {options.assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>{assignee.email}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700">
          Tag
          <select
            name="tagId"
            value={value.tagId ?? ''}
            onChange={(event) => set('tagId', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="">All tags</option>
            {options.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p aria-live="polite" className={matched === 0 ? 'font-medium text-amber-800' : 'text-gray-600'}>
          {matched === 0 ? 'No issues match these filters' : `Showing ${matched} of ${total} issues`}
        </p>
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={Object.values(value).every((entry) => !entry)}
          className="min-h-11 rounded-md border border-gray-300 bg-white px-3 font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear filters
        </button>
      </div>
    </fieldset>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
