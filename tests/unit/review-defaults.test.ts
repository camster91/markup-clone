import { describe, expect, it } from 'vitest';
import { expandReviewRoundTemplate, parseReviewDefaults } from '@/lib/review-defaults';

describe('client-account review defaults', () => {
  it('normalizes a numbered template and pause default', () => {
    expect(parseReviewDefaults({
      reviewRoundNameTemplate: '  Acme QA {n}  ',
      reviewRoundCommentsPaused: true,
    })).toEqual({
      ok: true,
      value: { reviewRoundNameTemplate: 'Acme QA {n}', reviewRoundCommentsPaused: true },
    });
  });

  it('requires a bounded numbered template and boolean pause value', () => {
    expect(parseReviewDefaults({ reviewRoundNameTemplate: 'Same name', reviewRoundCommentsPaused: false })).toMatchObject({ ok: false });
    expect(parseReviewDefaults({ reviewRoundNameTemplate: `${'x'.repeat(121)}{n}`, reviewRoundCommentsPaused: false })).toMatchObject({ ok: false });
    expect(parseReviewDefaults({ reviewRoundNameTemplate: 'Round {n}', reviewRoundCommentsPaused: 'yes' })).toMatchObject({ ok: false });
  });

  it('expands every numbered placeholder into the next round number', () => {
    expect(expandReviewRoundTemplate('QA {n} / pass {n}', 3)).toBe('QA 3 / pass 3');
  });
});
