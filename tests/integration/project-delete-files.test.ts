// DELETE /api/projects/[id] file cleanup.
//
// - Rows are deleted before files, so a failed DB delete leaves the project
//   intact with all its images (it used to unlink first).
// - Recapture history and comment attachments are removed too (they used
//   to be left on disk forever).
// - Unlink errors other than ENOENT are logged, not swallowed.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const CSRF = 'project-delete-csrf';

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    project: { findUnique: vi.fn(), delete: vi.fn() },
    screenshot: { findMany: vi.fn() },
    screenshotVersion: { findMany: vi.fn() },
    reviewAsset: { findMany: vi.fn() },
    attachment: { findMany: vi.fn() },
    unlink: vi.fn(),
    audit: vi.fn(),
    assertProjectAdmin: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: mocks.project,
    screenshot: mocks.screenshot,
    screenshotVersion: mocks.screenshotVersion,
    reviewAsset: mocks.reviewAsset,
    attachment: mocks.attachment,
  },
}));
vi.mock('fs/promises', () => ({ unlink: mocks.unlink }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/teams', () => ({
  assertProjectAdmin: mocks.assertProjectAdmin,
  assertProjectAccessible: vi.fn(),
}));

import { DELETE } from '../../src/app/api/projects/[id]/route';

function deleteReq(): Request {
  return new Request(`https://markup.ashbi.ca/api/projects/${PROJECT_ID}`, {
    method: 'DELETE',
    headers: {
      origin: 'https://markup.ashbi.ca',
      'X-CSRF-Token': CSRF,
      cookie: `markup.csrf=${CSRF}`,
    },
  });
}
const params = { params: Promise.resolve({ id: PROJECT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  process.env.SCREENSHOTS_DIR = '/data/screenshots';
  process.env.ATTACHMENTS_DIR = '/data/attachments';
  mocks.assertProjectAdmin.mockResolvedValue({ ok: true, teamId: null });
  mocks.project.findUnique.mockResolvedValue({ id: PROJECT_ID, name: 'P', domain: 'p.com' });
  mocks.screenshot.findMany.mockResolvedValue([{ storageKey: 'shot.png' }]);
  mocks.screenshotVersion.findMany.mockResolvedValue([{ storageKey: 'old-version.png' }]);
  mocks.reviewAsset.findMany.mockResolvedValue([{ storageKey: 'source.pdf' }]);
  mocks.attachment.findMany.mockResolvedValue([{ storageKey: 'note.webm' }]);
  mocks.project.delete.mockImplementation(async () => {
    mocks.order.push('db');
    return { id: PROJECT_ID };
  });
  mocks.unlink.mockImplementation(async (file: string) => {
    mocks.order.push(`unlink:${file}`);
  });
});

describe('DELETE /api/projects/[id] files', () => {
  it('deletes the rows first, then every file the project owned', async () => {
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(200);
    expect(mocks.order[0]).toBe('db');
    expect(mocks.order.slice(1).sort()).toEqual([
      'unlink:/data/attachments/note.webm',
      'unlink:/data/screenshots/old-version.png',
      'unlink:/data/screenshots/shot.png',
      'unlink:/data/screenshots/source.pdf',
    ]);
    expect(await res.json()).toMatchObject({ deleted: true, filesRemoved: 4, filesFailed: 0 });
  });

  it('removes no files when the DB delete fails', async () => {
    mocks.project.delete.mockRejectedValue(new Error('db down'));
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(500);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('ignores already-missing files but logs and counts other unlink errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.unlink.mockImplementation(async (file: string) => {
      if (file.endsWith('shot.png')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      if (file.endsWith('source.pdf')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    const res = await DELETE(deleteReq(), params);
    expect(await res.json()).toMatchObject({ filesRemoved: 2, filesFailed: 1 });
    expect(errSpy).toHaveBeenCalledWith(
      'Project delete: could not remove file',
      '/data/screenshots/source.pdf',
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});
