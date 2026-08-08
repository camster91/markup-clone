import { describe, expect, it, vi } from 'vitest';

import {
  LOAD_API_KEY,
  LOAD_PROJECT_ID,
  cleanupLoadFixture,
  seedLoadFixture,
} from '../../scripts/lib/load-fixture.mjs';

describe('seedLoadFixture', () => {
  it('upserts a dedicated unscoped local project', async () => {
    const upsert = vi.fn(async () => ({ id: LOAD_PROJECT_ID }));
    await seedLoadFixture({ project: { upsert } });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: LOAD_PROJECT_ID },
      update: {
        name: 'Local load rehearsal',
        domain: 'load-rehearsal.localhost',
        apiKey: LOAD_API_KEY,
        archivedAt: null,
        activeReviewRoundId: null,
      },
      create: {
        id: LOAD_PROJECT_ID,
        name: 'Local load rehearsal',
        domain: 'load-rehearsal.localhost',
        apiKey: LOAD_API_KEY,
      },
      select: { id: true },
    });
  });
});

describe('cleanupLoadFixture', () => {
  it('deletes the fixture rows and every screenshot file it discovered', async () => {
    const findMany = vi.fn(async () => [
      { storageKey: 'one.png' },
      { storageKey: 'two.png' },
    ]);
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const projectCount = vi.fn(async () => 0);
    const screenshotCount = vi.fn(async () => 0);
    const unlink = vi.fn(async (path: string) => path);
    const access = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    const result = await cleanupLoadFixture({
      screenshot: { findMany, count: screenshotCount },
      project: { deleteMany, count: projectCount },
    }, unlink, access, '/data/screenshots');

    expect(findMany).toHaveBeenCalledWith({
      where: { page: { projectId: LOAD_PROJECT_ID } },
      select: { storageKey: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: LOAD_PROJECT_ID } });
    expect(unlink.mock.calls.map(([path]) => path)).toEqual([
      '/data/screenshots/one.png',
      '/data/screenshots/two.png',
    ]);
    expect(projectCount).toHaveBeenCalledWith({ where: { id: LOAD_PROJECT_ID } });
    expect(screenshotCount).toHaveBeenCalledWith({ where: { page: { projectId: LOAD_PROJECT_ID } } });
    expect(result).toEqual({
      deletedProjects: 1,
      deletedFiles: 2,
      remainingProjects: 0,
      remainingScreenshots: 0,
      remainingFiles: 0,
    });
  });

  it('treats an already-missing screenshot as clean', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const result = await cleanupLoadFixture({
      screenshot: {
        findMany: vi.fn(async () => [{ storageKey: 'gone.png' }]),
        count: vi.fn(async () => 0),
      },
      project: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        count: vi.fn(async () => 0),
      },
    }, vi.fn(async () => { throw missing; }), vi.fn(async () => { throw missing; }), '/data/screenshots');
    expect(result).toEqual({
      deletedProjects: 0,
      deletedFiles: 0,
      remainingProjects: 0,
      remainingScreenshots: 0,
      remainingFiles: 0,
    });
  });

  it('surfaces unexpected filesystem cleanup failures', async () => {
    await expect(cleanupLoadFixture({
      screenshot: {
        findMany: vi.fn(async () => [{ storageKey: 'locked.png' }]),
        count: vi.fn(async () => 0),
      },
      project: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 0),
      },
    }, vi.fn(async () => { throw new Error('permission denied'); }), vi.fn(), '/data/screenshots'))
      .rejects.toThrow('permission denied');
  });

  it('fails verification if a captured screenshot file still exists', async () => {
    await expect(cleanupLoadFixture({
      screenshot: {
        findMany: vi.fn(async () => [{ storageKey: 'leftover.png' }]),
        count: vi.fn(async () => 0),
      },
      project: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 0),
      },
    }, vi.fn(async () => undefined), vi.fn(async () => undefined), '/data/screenshots'))
      .rejects.toThrow(/cleanup verification/i);
  });
});
