import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { resolveWorkspaceBranding } from './branding';
import { sendProjectNotificationEmails } from './email';
import { parseHost } from './origin';

export type ProjectNotificationEvent =
  | 'new-pin'
  | 'new-comment'
  | 'status-change'
  | 'assignment'
  | 'mention';

type NotificationClient = Pick<PrismaClient, 'project' | 'user'>;

type RecipientRow = {
  id: string;
  email: string;
  role: string;
  teamMembers: Array<{ role: string; projectId: string | null }>;
  notificationPreferences: Array<{
    newPinEmail: boolean;
    newCommentEmail: boolean;
    statusChangeEmail: boolean;
    assignmentEmail: boolean;
    mentionEmail: boolean;
  }>;
};

const eventField = {
  'new-pin': 'newPinEmail',
  'new-comment': 'newCommentEmail',
  'status-change': 'statusChangeEmail',
  assignment: 'assignmentEmail',
  mention: 'mentionEmail',
} as const;

function hasCurrentProjectAccess(
  user: RecipientRow,
  teamId: string | null,
  projectId: string
): boolean {
  if (user.role === 'operator' || teamId === null) return true;
  return user.teamMembers.some((membership) => {
    const role = membership.role === 'reviewer' ? 'client' : membership.role;
    return role === 'owner'
      || role === 'contributor'
      || role === 'client'
      || (role === 'guest' && membership.projectId === projectId);
  });
}

export async function resolveProjectNotificationRecipients(
  input: {
    projectId: string;
    event: ProjectNotificationEvent;
    actorUserId?: string | null;
    targetUserIds?: string[];
    excludeUserIds?: string[];
    excludeEmails?: string[];
  },
  client: NotificationClient = prisma
): Promise<{
  projectName: string;
  brand: { displayName: string; accentColor: string; accentText: string };
  recipients: string[];
} | null> {
  const project = await client.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      teamId: true,
      team: {
        select: {
          workspace: {
            select: {
              name: true,
              brandName: true,
              logoUrl: true,
              accentColor: true,
              reviewerWelcome: true,
            },
          },
        },
      },
    },
  });
  if (!project) return null;

  const targetUserIds = Array.from(new Set(input.targetUserIds ?? [])).slice(0, 100);
  const excludedUserIds = new Set(input.excludeUserIds ?? []);
  const excludedEmails = new Set((input.excludeEmails ?? []).map((email) => email.trim().toLowerCase()));
  const field = eventField[input.event];
  const users = await client.user.findMany({
    where: {
      ...(targetUserIds.length > 0 ? { id: { in: targetUserIds } } : {}),
      ...(input.event === 'mention' ? {} : {
        notificationPreferences: { some: { projectId: input.projectId, [field]: true } },
      }),
    },
    select: {
      id: true,
      email: true,
      role: true,
      teamMembers: {
        where: project.teamId ? { teamId: project.teamId } : undefined,
        select: { role: true, projectId: true },
      },
      notificationPreferences: {
        where: { projectId: input.projectId },
        select: {
          newPinEmail: true,
          newCommentEmail: true,
          statusChangeEmail: true,
          assignmentEmail: true,
          mentionEmail: true,
        },
      },
    },
  }) as unknown as RecipientRow[];

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const user of users) {
    if (input.actorUserId && user.id === input.actorUserId) continue;
    if (excludedUserIds.has(user.id)) continue;
    if (targetUserIds.length > 0 && !targetUserIds.includes(user.id)) continue;
    if (!hasCurrentProjectAccess(user, project.teamId, input.projectId)) continue;
    const preference = user.notificationPreferences[0];
    const enabled = input.event === 'mention'
      ? (preference?.mentionEmail ?? true)
      : (preference?.[field] ?? false);
    if (!enabled) continue;
    const key = user.email.trim().toLowerCase();
    if (!key || excludedEmails.has(key) || seen.has(key)) continue;
    seen.add(key);
    recipients.push(user.email.trim());
  }

  const branding = resolveWorkspaceBranding(project.team?.workspace ?? {
    name: 'Visual Feedback',
    brandName: null,
    logoUrl: null,
    accentColor: null,
    reviewerWelcome: null,
  });
  return {
    projectName: project.name,
    brand: {
      displayName: branding.displayName,
      accentColor: branding.accentColor,
      accentText: branding.accentText,
    },
    recipients,
  };
}

export async function sendProjectMemberNotification(input: {
  projectId: string;
  pinId: string;
  event: ProjectNotificationEvent;
  title: string;
  message: string;
  actorUserId?: string | null;
  targetUserIds?: string[];
  excludeUserIds?: string[];
  excludeEmails?: string[];
}) {
  try {
    const delivery = await resolveProjectNotificationRecipients(input);
    if (!delivery || delivery.recipients.length === 0) return;
    const origin = parseHost(process.env.DASHBOARD_HOST).origin;
    const actionUrl = `${origin}/projects/${encodeURIComponent(input.projectId)}?pin=${encodeURIComponent(input.pinId)}`;
    await sendProjectNotificationEmails({
      recipients: delivery.recipients,
      brand: delivery.brand,
      projectName: delivery.projectName,
      title: input.title,
      message: input.message,
      actionUrl,
    });
  } catch (error) {
    console.error('[email] Project member notification failed:', error);
  }
}
