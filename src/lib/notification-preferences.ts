export const NOTIFICATION_PREFERENCE_FIELDS = [
  'newPinEmail',
  'newCommentEmail',
  'statusChangeEmail',
  'assignmentEmail',
  'mentionEmail',
] as const;

export type NotificationPreferenceField = typeof NOTIFICATION_PREFERENCE_FIELDS[number];
export type NotificationPreferences = Record<NotificationPreferenceField, boolean>;
export type NotificationPreferenceRole =
  | 'operator'
  | 'owner'
  | 'contributor'
  | 'client'
  | 'guest'
  | 'legacy-reviewer';

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    newPinEmail: false,
    newCommentEmail: false,
    statusChangeEmail: false,
    assignmentEmail: false,
    mentionEmail: true,
  };
}

export function recommendedNotificationPreferences(
  role: NotificationPreferenceRole
): NotificationPreferences {
  if (role === 'operator' || role === 'owner' || role === 'contributor') {
    return {
      newPinEmail: true,
      newCommentEmail: false,
      statusChangeEmail: true,
      assignmentEmail: true,
      mentionEmail: true,
    };
  }
  return {
    newPinEmail: false,
    newCommentEmail: true,
    statusChangeEmail: true,
    assignmentEmail: false,
    mentionEmail: true,
  };
}

export function parseNotificationPreferences(input: unknown):
  | { ok: true; value: NotificationPreferences }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Notification preferences must be an object' };
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== NOTIFICATION_PREFERENCE_FIELDS.length
    || keys.some((key) => !NOTIFICATION_PREFERENCE_FIELDS.includes(key as NotificationPreferenceField))
  ) {
    return { ok: false, error: 'Notification preferences must include only the supported fields' };
  }

  const value = {} as NotificationPreferences;
  for (const field of NOTIFICATION_PREFERENCE_FIELDS) {
    if (typeof record[field] !== 'boolean') {
      return { ok: false, error: `${field} must be a boolean` };
    }
    value[field] = record[field];
  }
  return { ok: true, value };
}
