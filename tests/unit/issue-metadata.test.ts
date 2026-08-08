import { describe, expect, it } from 'vitest';
import {
  normalizeTagNames,
  parseIssueMetadataPatch,
  pinMatchesIssueFilters,
} from '@/lib/issue-metadata';

describe('internal issue metadata input', () => {
  it('normalizes, case-deduplicates, and bounds reusable tag names', () => {
    expect(normalizeTagNames(['  Front End ', 'front   end', 'QA'])).toEqual({
      ok: true,
      value: [
        { name: 'Front End', key: 'front end' },
        { name: 'QA', key: 'qa' },
      ],
    });

    expect(normalizeTagNames(['one', 'two', 'three', 'four', 'five', 'six'])).toMatchObject({ ok: false });
    expect(normalizeTagNames([''])).toMatchObject({ ok: false });
    expect(normalizeTagNames(['x'.repeat(33)])).toMatchObject({ ok: false });
    expect(normalizeTagNames(['valid', 'bad\u0000tag'])).toMatchObject({ ok: false });
  });

  it('accepts a closed priority, nullable assignment, and an explicit tag replacement', () => {
    expect(parseIssueMetadataPatch({
      status: 'RESOLVED',
      priority: 'HIGH',
      assigneeId: null,
      tagNames: ['Browser', 'Front end'],
    })).toEqual({
      ok: true,
      value: {
        status: 'RESOLVED',
        priority: 'HIGH',
        assigneeId: null,
        tags: [
          { name: 'Browser', key: 'browser' },
          { name: 'Front end', key: 'front end' },
        ],
        hasInternalChanges: true,
      },
    });
  });

  it('rejects unknown values and requests with no supported change', () => {
    expect(parseIssueMetadataPatch({ priority: 'BLOCKER' })).toMatchObject({ ok: false });
    expect(parseIssueMetadataPatch({ status: 'PENDING' })).toMatchObject({ ok: false });
    expect(parseIssueMetadataPatch({ assigneeId: 'not-a-uuid' })).toMatchObject({ ok: false });
    expect(parseIssueMetadataPatch({ tagNames: 'QA' })).toMatchObject({ ok: false });
    expect(parseIssueMetadataPatch({ irrelevant: true })).toMatchObject({ ok: false });
  });
});

describe('agency issue filters', () => {
  const pin = {
    status: 'OPEN',
    priority: 'HIGH',
    assignee: { id: 'user-1' },
    tags: [{ id: 'tag-1' }, { id: 'tag-2' }],
  };

  it('uses AND semantics across active filters', () => {
    expect(pinMatchesIssueFilters(pin, {
      status: 'OPEN', priority: 'HIGH', assigneeId: 'user-1', tagId: 'tag-2',
    })).toBe(true);
    expect(pinMatchesIssueFilters(pin, {
      status: 'OPEN', priority: 'LOW', assigneeId: 'user-1', tagId: 'tag-2',
    })).toBe(false);
  });

  it('supports unassigned work and ignores unset filters', () => {
    expect(pinMatchesIssueFilters({ ...pin, assignee: null }, { assigneeId: 'UNASSIGNED' })).toBe(true);
    expect(pinMatchesIssueFilters(pin, {})).toBe(true);
  });
});
