import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectNotificationRecipients } from '@/lib/project-notification-delivery';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

const project = {
  id: PROJECT_ID,
  name: 'Client <Site>',
  teamId: TEAM_ID,
  team: {
    workspace: {
      name: 'Agency',
      brandName: 'Northstar Studio',
      logoUrl: null,
      accentColor: '#4f46e5',
      reviewerWelcome: null,
    },
  },
};

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'owner@example.com',
    role: 'reviewer',
    teamMembers: [{ role: 'owner', projectId: null }],
    notificationPreferences: [{
      newPinEmail: true,
      newCommentEmail: false,
      statusChangeEmail: true,
      assignmentEmail: true,
      mentionEmail: true,
    }],
    ...overrides,
  };
}

const client = {
  project: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  client.project.findUnique.mockResolvedValue(project);
  client.user.findMany.mockResolvedValue([]);
});

describe('project notification recipient resolution', () => {
  it('uses the active event preference, excludes the actor, and deduplicates email addresses', async () => {
    client.user.findMany.mockResolvedValue([
      user(),
      user({ id: 'actor', email: 'actor@example.com' }),
      user({ id: 'duplicate', email: 'OWNER@example.com' }),
      user({ id: 'excluded', email: 'mentioned@example.com' }),
      user({ id: 'comment-only', email: 'comment@example.com', notificationPreferences: [{
        newPinEmail: false, newCommentEmail: true, statusChangeEmail: false,
        assignmentEmail: false, mentionEmail: true,
      }] }),
    ]);

    const result = await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'new-pin',
      actorUserId: 'actor',
      excludeUserIds: ['excluded'],
    }, client as never);

    expect(result).toEqual({
      projectName: 'Client <Site>',
      brand: { displayName: 'Northstar Studio', accentColor: '#4f46e5', accentText: '#ffffff' },
      recipients: ['owner@example.com'],
    });
  });

  it('rejects removed members and guests scoped to another project despite stale preferences', async () => {
    client.user.findMany.mockResolvedValue([
      user({ id: 'removed', email: 'removed@example.com', teamMembers: [] }),
      user({ id: 'wrong-guest', email: 'guest@example.com', teamMembers: [{ role: 'guest', projectId: 'other-project' }] }),
      user({ id: 'right-guest', email: 'right@example.com', teamMembers: [{ role: 'guest', projectId: PROJECT_ID }] }),
      user({ id: 'operator', email: 'operator@example.com', role: 'operator', teamMembers: [] }),
    ]);

    const result = await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'status-change',
    }, client as never);

    expect(result?.recipients.sort()).toEqual(['operator@example.com', 'right@example.com']);
  });

  it('keeps direct mentions enabled without a row, honors explicit opt-out, and limits targets', async () => {
    client.user.findMany.mockResolvedValue([
      user({ id: 'legacy', email: 'legacy@example.com', notificationPreferences: [] }),
      user({ id: 'muted', email: 'muted@example.com', notificationPreferences: [{
        newPinEmail: false, newCommentEmail: false, statusChangeEmail: false,
        assignmentEmail: false, mentionEmail: false,
      }] }),
      user({ id: 'not-targeted', email: 'other@example.com', notificationPreferences: [] }),
    ]);

    const result = await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'mention',
      targetUserIds: ['legacy', 'muted'],
    }, client as never);

    expect(result?.recipients).toEqual(['legacy@example.com']);
  });

  it('keeps assignment email opt-in and returns no delivery for a missing project', async () => {
    client.user.findMany.mockResolvedValue([
      user({ id: 'assigned-no-row', email: 'no-row@example.com', notificationPreferences: [] }),
      user({ id: 'assigned-opted-in', email: 'yes@example.com' }),
    ]);
    const result = await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'assignment',
      targetUserIds: ['assigned-no-row', 'assigned-opted-in'],
    }, client as never);
    expect(result?.recipients).toEqual(['yes@example.com']);

    client.project.findUnique.mockResolvedValueOnce(null);
    expect(await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'new-comment',
    }, client as never)).toBeNull();
    expect(client.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('excludes addresses already handled by the legacy external-alert channel', async () => {
    client.user.findMany.mockResolvedValue([
      user({ email: 'Shared@Example.com' }),
      user({ id: 'other', email: 'other@example.com' }),
    ]);
    const result = await resolveProjectNotificationRecipients({
      projectId: PROJECT_ID,
      event: 'new-pin',
      excludeEmails: ['shared@example.com'],
    }, client as never);
    expect(result?.recipients).toEqual(['other@example.com']);
  });
});
