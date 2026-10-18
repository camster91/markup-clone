import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTACHMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CSRF_TOKEN = 'attachment-ownership-csrf';

const mocks = vi.hoisted(() => ({
  attachment: { create: vi.fn(), findMany: vi.fn() },
  comment: { create: vi.fn(), findUnique: vi.fn() },
  pin: { findUnique: vi.fn(), update: vi.fn() },
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

const access = vi.hoisted(() => ({
  assertProjectAccessible: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/teams', () => access);
vi.mock('fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink }));
vi.mock('@/lib/events', () => ({ emit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendMentionEmail: vi.fn() }));
vi.mock('@/lib/project-notification-delivery', () => ({ sendProjectMemberNotification: vi.fn() }));

import { POST as uploadAttachment } from '@/app/api/attachments/route';
import { POST as createComment } from '@/app/api/pins/[id]/comments/route';
import { _resetBucket } from '@/lib/rate-limit';

const UPLOAD_BUCKET = `attachments:origin:https://markup.ashbi.ca:${PROJECT_ID}`;

function uploadRequest(projectId?: string, commentId?: string): Request {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'paste.png', { type: 'image/png' }));
  if (projectId) form.append('projectId', projectId);
  if (commentId) form.append('commentId', commentId);
  return new Request('https://markup.ashbi.ca/api/attachments', {
    method: 'POST',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: form,
  });
}

function commentRequest(): Request {
  return new Request(`https://markup.ashbi.ca/api/pins/${PIN_ID}/comments`, {
    method: 'POST',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
    body: JSON.stringify({ text: '', attachmentIds: [ATTACHMENT_ID] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetBucket(UPLOAD_BUCKET);
  mocks.unlink.mockResolvedValue(undefined);
  access.assertProjectAccessible.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: null,
    caller: { id: 'reviewer-1', email: 'reviewer@example.com', role: 'reviewer' },
    membershipRole: 'legacy-reviewer',
  });
  mocks.attachment.create.mockResolvedValue({ id: ATTACHMENT_ID, kind: 'image', size: 4 });
  mocks.attachment.findMany.mockResolvedValue([{ id: ATTACHMENT_ID }]);
  mocks.comment.create.mockResolvedValue({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    text: '',
    author: 'Reviewer',
    authorRole: 'reviewer',
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    attachments: [],
  });
  mocks.comment.findUnique.mockResolvedValue({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pin: { screenshot: { page: { projectId: PROJECT_ID } } },
  });
  mocks.pin.findUnique.mockResolvedValue({
    status: 'OPEN',
    screenshot: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      page: { projectId: PROJECT_ID, project: { name: 'Client site' } },
    },
  });
});

describe('attachment project ownership', () => {
  it('requires a project id before accepting an orphan upload', async () => {
    const response = await uploadAttachment(uploadRequest());

    expect(response.status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.attachment.create).not.toHaveBeenCalled();
  });

  it('rejects an upload when the caller cannot access its project', async () => {
    access.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Not a member of this project team',
    });

    const response = await uploadAttachment(uploadRequest(PROJECT_ID));

    expect(response.status).toBe(403);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('stores the owning project on an authorized upload', async () => {
    const { audit } = await import('@/lib/audit');
    const response = await uploadAttachment(uploadRequest(PROJECT_ID));

    expect(response.status).toBe(201);
    expect(mocks.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: PROJECT_ID }),
      })
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'reviewer@example.com',
        action: 'attachment.create',
        target: ATTACHMENT_ID,
        metadata: expect.objectContaining({
          kind: 'image',
          projectId: PROJECT_ID,
        }),
      })
    );
  });

  it('rejects binding an upload to a comment in another project', async () => {
    mocks.comment.findUnique.mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      pin: {
        screenshot: {
          page: { projectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
        },
      },
    });

    const response = await uploadAttachment(
      uploadRequest(PROJECT_ID, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    );

    expect(response.status).toBe(403);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('claims only unbound attachments owned by the pin project', async () => {
    const response = await createComment(commentRequest(), {
      params: Promise.resolve({ id: PIN_ID }),
    });

    expect(response.status).toBe(201);
    expect(mocks.attachment.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [ATTACHMENT_ID] },
        commentId: null,
        projectId: PROJECT_ID,
      },
      select: { id: true },
    });
  });
});

describe('attachment upload rate limit', () => {
  it('returns 429 with Retry-After once the per-(origin, project) bucket is drained, before any disk write', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await uploadAttachment(uploadRequest(PROJECT_ID));
      expect(ok.status).toBe(201);
    }
    mocks.writeFile.mockClear();
    mocks.attachment.create.mockClear();

    const limited = await uploadAttachment(uploadRequest(PROJECT_ID));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.attachment.create).not.toHaveBeenCalled();
  });

  it('does not consume the bucket for a caller who fails the project access check', async () => {
    access.assertProjectAccessible.mockResolvedValue({ ok: false, status: 403, error: 'denied' });
    for (let i = 0; i < 25; i++) {
      const res = await uploadAttachment(uploadRequest(PROJECT_ID));
      expect(res.status).toBe(403);
    }
  });
});

describe('attachment upload cleanup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('removes the written file and returns 500 when the DB insert fails', async () => {
    vi.stubEnv('SCREENSHOTS_DIR', '/data/screenshots');
    vi.stubEnv('ATTACHMENTS_DIR', '');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.attachment.create.mockRejectedValue(new Error('db down'));

    const response = await uploadAttachment(uploadRequest(PROJECT_ID));

    expect(response.status).toBe(500);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const writtenPath = mocks.writeFile.mock.calls[0][0];
    // Default location is inside the mounted screenshots volume, so the
    // file survives a redeploy (see src/lib/storage-dirs.ts).
    expect(writtenPath).toMatch(/^\/data\/screenshots\/attachments\/[0-9a-f-]{36}\.png$/);
    expect(mocks.unlink).toHaveBeenCalledWith(writtenPath);
    // The original DB error is still logged and surfaced.
    expect(errorSpy).toHaveBeenCalledWith('Attachment create error:', expect.objectContaining({ message: 'db down' }));
    errorSpy.mockRestore();
  });

  it('logs (does not swallow) a failed cleanup and still returns 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.attachment.create.mockRejectedValue(new Error('db down'));
    mocks.unlink.mockRejectedValue(new Error('EACCES'));

    const response = await uploadAttachment(uploadRequest(PROJECT_ID));

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      '[attachments] failed to remove orphaned upload',
      mocks.writeFile.mock.calls[0][0],
      expect.objectContaining({ message: 'EACCES' }),
    );
    errorSpy.mockRestore();
  });
});
