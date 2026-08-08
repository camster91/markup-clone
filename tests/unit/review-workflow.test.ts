import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATUSES,
  canTransitionReviewStatus,
  parseReviewStatus,
  sanitizeReviewRoundName,
  sanitizeSignOffNote,
} from '@/lib/review-workflow';

describe('review workflow domain', () => {
  it('uses the documented closed status set', () => {
    expect(REVIEW_STATUSES).toEqual([
      'DRAFT',
      'IN_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
      'ARCHIVED',
    ]);
    expect(parseReviewStatus('APPROVED')).toBe('APPROVED');
    expect(parseReviewStatus('approved')).toBeNull();
    expect(parseReviewStatus('DONE')).toBeNull();
  });

  it('enforces intentional review lifecycle transitions', () => {
    expect(canTransitionReviewStatus('DRAFT', 'IN_REVIEW')).toBe(true);
    expect(canTransitionReviewStatus('IN_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionReviewStatus('APPROVED', 'CHANGES_REQUESTED')).toBe(true);
    expect(canTransitionReviewStatus('ARCHIVED', 'IN_REVIEW')).toBe(false);
    expect(canTransitionReviewStatus('DRAFT', 'APPROVED')).toBe(false);
  });

  it('bounds names and sign-off notes', () => {
    expect(sanitizeReviewRoundName('  Homepage round  ')).toEqual({ ok: true, value: 'Homepage round' });
    expect(sanitizeReviewRoundName('')).toEqual({ ok: true, value: null });
    expect(sanitizeReviewRoundName('x'.repeat(121)).ok).toBe(false);
    expect(sanitizeSignOffNote('  Looks ready  ')).toEqual({ ok: true, value: 'Looks ready' });
    expect(sanitizeSignOffNote('x'.repeat(1001)).ok).toBe(false);
  });
});
