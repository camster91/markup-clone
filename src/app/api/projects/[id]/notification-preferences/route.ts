import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { assertProjectAccessible } from '@/lib/teams';
import { validateProjectId } from '@/lib/validation';
import {
  defaultNotificationPreferences,
  parseNotificationPreferences,
  recommendedNotificationPreferences,
  type NotificationPreferenceRole,
  type NotificationPreferences,
} from '@/lib/notification-preferences';

const preferenceSelect = {
  newPinEmail: true,
  newCommentEmail: true,
  statusChangeEmail: true,
  assignmentEmail: true,
  mentionEmail: true,
} as const;

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

type ProjectAccess = Extract<
  Awaited<ReturnType<typeof assertProjectAccessible>>,
  { ok: true }
>;

async function resolveAccess(id: string): Promise<
  | { kind: 'error'; response: NextResponse }
  | { kind: 'ok'; access: ProjectAccess }
> {
  const idResult = validateProjectId(id);
  if (!idResult.ok) {
    return { kind: 'error', response: json({ error: idResult.error }, { status: 400 }) };
  }
  const access = await assertProjectAccessible(id);
  if (!access.ok) {
    return { kind: 'error', response: json({ error: access.error }, { status: access.status }) };
  }
  return { kind: 'ok', access };
}

function responseBody(
  role: NotificationPreferenceRole,
  row: NotificationPreferences | null
) {
  return {
    saved: row !== null,
    role,
    preferences: row ?? defaultNotificationPreferences(),
    recommended: recommendedNotificationPreferences(role),
  };
}

function toPreferences(row: NotificationPreferences): NotificationPreferences {
  return {
    newPinEmail: row.newPinEmail,
    newCommentEmail: row.newCommentEmail,
    statusChangeEmail: row.statusChangeEmail,
    assignmentEmail: row.assignmentEmail,
    mentionEmail: row.mentionEmail,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;

  try {
    const { id } = await params;
    const result = await resolveAccess(id);
    if (result.kind === 'error') return result.response;
    const { access } = result;
    const role = access.membershipRole as NotificationPreferenceRole;
    const preference = await prisma.projectNotificationPreference.findUnique({
      where: { projectId_userId: { projectId: id, userId: access.caller.id } },
      select: preferenceSelect,
    });
    return json(responseBody(role, preference ? toPreferences(preference) : null));
  } catch (error) {
    console.error('Notification preference read error:', error);
    return json({ error: 'Failed to load notification preferences' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireDashboardAuth(req);
  if (authError) return authError;
  const csrfError = requireCsrfToken(req);
  if (csrfError) return csrfError;

  try {
    const { id } = await params;
    const result = await resolveAccess(id);
    if (result.kind === 'error') return result.response;
    const { access } = result;
    const parsed = parseNotificationPreferences(await req.json());
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

    const preference = await prisma.projectNotificationPreference.upsert({
      where: { projectId_userId: { projectId: id, userId: access.caller.id } },
      create: { projectId: id, userId: access.caller.id, ...parsed.value },
      update: parsed.value,
      select: preferenceSelect,
    });
    return json({
      saved: true,
      role: access.membershipRole,
      preferences: toPreferences(preference),
    });
  } catch (error) {
    console.error('Notification preference update error:', error);
    return json({ error: 'Failed to update notification preferences' }, { status: 500 });
  }
}
