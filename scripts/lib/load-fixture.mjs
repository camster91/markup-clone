import path from 'node:path';

export const LOAD_PROJECT_ID = '96000000-0000-4000-8000-000000000001';
export const LOAD_API_KEY = 'local-load-rehearsal-key-not-for-production';

export async function seedLoadFixture(prisma) {
  return prisma.project.upsert({
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
}

export async function cleanupLoadFixture(prisma, unlink, access, screenshotsDir) {
  const screenshots = await prisma.screenshot.findMany({
    where: { page: { projectId: LOAD_PROJECT_ID } },
    select: { storageKey: true },
  });
  let deletedFiles = 0;
  for (const { storageKey } of screenshots) {
    if (path.posix.basename(storageKey) !== storageKey) {
      throw new Error(`Unsafe screenshot storage key: ${storageKey}`);
    }
    try {
      await unlink(path.posix.join(screenshotsDir, storageKey));
      deletedFiles += 1;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  const deleted = await prisma.project.deleteMany({ where: { id: LOAD_PROJECT_ID } });
  const [remainingProjects, remainingScreenshots] = await Promise.all([
    prisma.project.count({ where: { id: LOAD_PROJECT_ID } }),
    prisma.screenshot.count({ where: { page: { projectId: LOAD_PROJECT_ID } } }),
  ]);
  let remainingFiles = 0;
  for (const { storageKey } of screenshots) {
    try {
      await access(path.posix.join(screenshotsDir, storageKey));
      remainingFiles += 1;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  if (remainingProjects || remainingScreenshots || remainingFiles) {
    throw new Error(
      `Load fixture cleanup verification failed: projects=${remainingProjects}, screenshots=${remainingScreenshots}, files=${remainingFiles}`,
    );
  }
  return {
    deletedProjects: deleted.count,
    deletedFiles,
    remainingProjects,
    remainingScreenshots,
    remainingFiles,
  };
}
