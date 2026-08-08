import { describe, expect, it } from 'vitest';
import {
  defaultNotificationPreferences,
  parseNotificationPreferences,
  recommendedNotificationPreferences,
} from '@/lib/notification-preferences';

describe('notification preference defaults', () => {
  it('preserves legacy direct mentions without silently subscribing members to other mail', () => {
    expect(defaultNotificationPreferences()).toEqual({
      newPinEmail: false,
      newCommentEmail: false,
      statusChangeEmail: false,
      assignmentEmail: false,
      mentionEmail: true,
    });
  });

  it('recommends an agency workflow preset to operators, owners, and contributors', () => {
    for (const role of ['operator', 'owner', 'contributor'] as const) {
      expect(recommendedNotificationPreferences(role)).toEqual({
        newPinEmail: true,
        newCommentEmail: false,
        statusChangeEmail: true,
        assignmentEmail: true,
        mentionEmail: true,
      });
    }
  });

  it('recommends a review-focused preset to clients, guests, and legacy reviewers', () => {
    for (const role of ['client', 'guest', 'legacy-reviewer'] as const) {
      expect(recommendedNotificationPreferences(role)).toEqual({
        newPinEmail: false,
        newCommentEmail: true,
        statusChangeEmail: true,
        assignmentEmail: false,
        mentionEmail: true,
      });
    }
  });
});

describe('notification preference input', () => {
  const complete = {
    newPinEmail: true,
    newCommentEmail: false,
    statusChangeEmail: true,
    assignmentEmail: false,
    mentionEmail: true,
  };

  it('accepts exactly the complete boolean preference shape', () => {
    expect(parseNotificationPreferences(complete)).toEqual({ ok: true, value: complete });
  });

  it('rejects missing, non-boolean, array, and unknown fields', () => {
    expect(parseNotificationPreferences({ ...complete, mentionEmail: undefined }).ok).toBe(false);
    expect(parseNotificationPreferences({ ...complete, newPinEmail: 'yes' }).ok).toBe(false);
    expect(parseNotificationPreferences([]).ok).toBe(false);
    expect(parseNotificationPreferences({ ...complete, digest: true }).ok).toBe(false);
  });
});
