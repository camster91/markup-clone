import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDashboardAuth } from '@/lib/auth';
import { requireCsrfToken } from '@/lib/csrf';
import { audit } from '@/lib/audit';
import { unlink } from 'fs/promises';
import { validatePinId } from '@/lib/validation';
import { assertProjectAccessible, assertProjectAdmin } from '@/lib/teams';
import { parseIssueMetadataPatch } from '@/lib/issue-metadata';
import { sendProjectMemberNotification } from '@/lib/project-notification-delivery';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/data/screenshots';

async function resolvePinProject(pinId: string): Promise<{
  projectId: string;
  status: string;
  assigneeId: string | null;
} | null> {
  const pin = await prisma.pin.findUnique({
    where: { id: pinId },
    select: {
      status: true,
      assigneeId: true,
      screenshot: { select: { page: { select: { projectId: true } } } },
    },
  });
  const projectId = pin?.screenshot?.page?.projectId;
  return projectId ? {
    projectId,
    status: pin.status,
    assigneeId: pin.assigneeId,
  } : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    const pinBefore = await resolvePinProject(id);
    if (!pinBefore) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
    }
    const { projectId } = pinBefore;
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body: unknown = await req.json();
    const hasInternalFields = Boolean(
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && ['priority', 'assigneeId', 'tagNames'].some((key) => Object.hasOwn(body, key))
    );

    let admin: Awaited<ReturnType<typeof assertProjectAdmin>> | null = null;
    if (hasInternalFields) {
      admin = await assertProjectAdmin(projectId);
      if (!admin.ok) {
        return NextResponse.json({ error: admin.error }, { status: admin.status });
      }
    }

    const parsed = parseIssueMetadataPatch(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const patch = parsed.value;

    if (!patch.hasInternalChanges) {
      const pin = await prisma.pin.update({
        where: { id },
        data: { status: patch.status },
        select: { id: true, status: true },
      });
      if (patch.status !== undefined && patch.status !== pinBefore.status) {
        const resolved = patch.status === 'RESOLVED';
        void sendProjectMemberNotification({
          projectId,
          pinId: id,
          event: 'status-change',
          title: resolved ? 'Feedback resolved' : 'Feedback reopened',
          message: `${access.caller.email} marked feedback as ${resolved ? 'resolved' : 'open'}.`,
          actorUserId: access.caller.id,
        });
      }
      return NextResponse.json({
        success: true,
        data: { id: pin.id, status: pin.status },
      });
    }

    // An assignee must be a claimed User who belongs to this project's team.
    // Pending invitations have userId=null and therefore cannot match.
    if (patch.assigneeId) {
      if (!admin?.ok || !admin.teamId) {
        return NextResponse.json({ error: 'assignee must belong to the project team' }, { status: 400 });
      }
      const membership = await prisma.teamMember.findFirst({
        where: { teamId: admin.teamId, userId: patch.assigneeId },
        select: { userId: true, user: { select: { id: true, email: true } } },
      });
      if (!membership?.userId || !membership.user) {
        return NextResponse.json({ error: 'assignee must belong to the project team' }, { status: 400 });
      }
    }

    const data = {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
      ...(patch.tags !== undefined ? {
        tags: {
          deleteMany: {},
          create: patch.tags.map((tag) => ({
            tag: {
              connectOrCreate: {
                where: { projectId_key: { projectId, key: tag.key } },
                create: { projectId, name: tag.name, key: tag.key },
              },
            },
          })),
        },
      } : {}),
    };

    const pin = await prisma.pin.update({
      where: { id },
      data,
      select: {
        id: true,
        status: true,
        priority: true,
        assignee: { select: { id: true, email: true } },
        tags: { select: { tag: { select: { id: true, name: true, key: true } } } },
      },
    });
    const responsePin = {
      id: pin.id,
      status: pin.status,
      priority: pin.priority,
      assignee: pin.assignee,
      tags: pin.tags.map(({ tag }) => tag),
    };
    audit({
      actor: admin?.ok ? admin.caller.email : 'dashboard',
      action: 'pin.update',
      target: id,
      metadata: {
        projectId,
        fields: Object.keys(data),
      },
    });
    const notificationActor = admin?.ok ? admin.caller : access.caller;
    if (patch.status !== undefined && patch.status !== pinBefore.status) {
      const resolved = patch.status === 'RESOLVED';
      void sendProjectMemberNotification({
        projectId,
        pinId: id,
        event: 'status-change',
        title: resolved ? 'Feedback resolved' : 'Feedback reopened',
        message: `${notificationActor.email} marked feedback as ${resolved ? 'resolved' : 'open'}.`,
        actorUserId: notificationActor.id,
      });
    }
    if (patch.assigneeId && patch.assigneeId !== pinBefore.assigneeId) {
      void sendProjectMemberNotification({
        projectId,
        pinId: id,
        event: 'assignment',
        title: 'Feedback assigned to you',
        message: `${notificationActor.email} assigned feedback to you.`,
        actorUserId: notificationActor.id,
        targetUserIds: [patch.assigneeId],
      });
    }
    return NextResponse.json({ success: true, data: responsePin });
  } catch (error) {
    console.error('Pin update error:', error);
    return NextResponse.json({ error: 'Failed to update pin' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireDashboardAuth(req);
  if (authErr) return authErr;
  const csrfErr = requireCsrfToken(req);
  if (csrfErr) return csrfErr;

  try {
    const { id } = await params;
    const idRes = validatePinId(id);
    if (!idRes.ok) {
      return NextResponse.json({ error: idRes.error }, { status: 400 });
    }

    const pinBefore = await resolvePinProject(id);
    if (!pinBefore) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
    }
    const { projectId } = pinBefore;
    const access = await assertProjectAccessible(projectId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Find the pin and its screenshot
    const pin = await prisma.pin.findUnique({
      where: { id },
      select: { screenshotId: true },
    });
    if (!pin) return NextResponse.json({ error: 'Pin not found' }, { status: 404 });

    const screenshot = await prisma.screenshot.findUnique({
      where: { id: pin.screenshotId },
      select: { storageKey: true },
    });

    // Delete the screenshot file from disk
    if (screenshot) {
      try {
        await unlink(`${SCREENSHOTS_DIR}/${screenshot.storageKey}`);
      } catch {
        // File may already be missing
      }
      // Delete the screenshot row (cascade removes comments)
      await prisma.screenshot.delete({ where: { id: pin.screenshotId } });
    }

    // Delete the pin
    await prisma.pin.delete({ where: { id } });
    audit({ actor: pin.screenshotId, action: 'pin.delete', target: id });

    return NextResponse.json({
      deleted: true,
      pin: 1,
      screenshotFile: screenshot?.storageKey ?? null,
    });
  } catch (error) {
    console.error('Pin delete error:', error);
    return NextResponse.json({ error: 'Failed to delete pin' }, { status: 500 });
  }
}
