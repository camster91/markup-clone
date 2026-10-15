// DELETE /api/annotations/[id] — tenant scoping.
//
// The route used to delete any annotation for any authenticated dashboard
// session. It now resolves annotation -> pin -> screenshot -> page ->
// project and requires assertProjectAccessible before deleting, and the
// audit row names the caller instead of the literal 'dashboard'.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ANNOTATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CSRF_TOKEN = 'annotation-delete-csrf';

const mocks = vi.hoisted(() => ({
  annotation: { findUnique: vi.fn(), delete: vi.fn() },
  audit: vi.fn(),
  assertProjectAccessible: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { annotation: mocks.annotation } }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/teams', () => ({ assertProjectAccessible: mocks.assertProjectAccessible }));

import { DELETE } from '@/app/api/annotations/[id]/route';

function deleteRequest(): Request {
  return new Request(`https://markup.ashbi.ca/api/annotations/${ANNOTATION_ID}`, {
    method: 'DELETE',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF_TOKEN,
      cookie: `markup.csrf=${CSRF_TOKEN}`,
    },
  });
}

const params = () => ({ params: Promise.resolve({ id: ANNOTATION_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.annotation.findUnique.mockResolvedValue({
    id: ANNOTATION_ID,
    pinId: PIN_ID,
    pin: { screenshot: { page: { projectId: PROJECT_ID } } },
  });
  mocks.annotation.delete.mockResolvedValue({ id: ANNOTATION_ID });
  mocks.assertProjectAccessible.mockResolvedValue({
    ok: true,
    projectId: PROJECT_ID,
    teamId: 'team-1',
    caller: { id: 'user-1', email: 'member@example.com', role: 'reviewer' },
    membershipRole: 'contributor',
  });
});

describe('DELETE /api/annotations/[id] — project scoping', () => {
  it('checks access against the project that owns the annotation', async () => {
    const res = await DELETE(deleteRequest(), params());
    expect(res.status).toBe(200);
    expect(mocks.assertProjectAccessible).toHaveBeenCalledWith(PROJECT_ID);
    expect(mocks.annotation.delete).toHaveBeenCalledWith({ where: { id: ANNOTATION_ID } });
  });

  it('returns 403 and does not delete when the caller cannot access the project', async () => {
    mocks.assertProjectAccessible.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not a member of this project's team",
    });
    const res = await DELETE(deleteRequest(), params());
    expect(res.status).toBe(403);
    expect(mocks.annotation.delete).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('returns 404 when the annotation does not exist', async () => {
    mocks.annotation.findUnique.mockResolvedValue(null);
    const res = await DELETE(deleteRequest(), params());
    expect(res.status).toBe(404);
    expect(mocks.assertProjectAccessible).not.toHaveBeenCalled();
    expect(mocks.annotation.delete).not.toHaveBeenCalled();
  });

  it('audits the delete with the caller email as actor', async () => {
    await DELETE(deleteRequest(), params());
    expect(mocks.audit).toHaveBeenCalledWith({
      actor: 'member@example.com',
      action: 'pin.delete',
      target: PIN_ID,
      metadata: { annotationId: ANNOTATION_ID, projectId: PROJECT_ID },
    });
  });
});
