const { PrismaClient } = require('/app/node_modules/@prisma/client');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = process.env.DATABASE_URL || '';
const dashboardHost = process.env.DASHBOARD_HOST || '';
if (!databaseUrl.includes('@postgres:5432/markup_db') || !dashboardHost.includes('localhost:3030')) {
  throw new Error('Refusing to seed outside the disposable local Compose stack');
}

const prisma = new PrismaClient();
const USER_ID = '94000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '94000000-0000-4000-8000-000000000002';
const TEAM_ID = '94000000-0000-4000-8000-000000000003';
const MEMBER_ID = '94000000-0000-4000-8000-000000000004';
const PROJECT_ID = '94000000-0000-4000-8000-000000000005';
const PAGE_ID = '94000000-0000-4000-8000-000000000006';
const SCREENSHOT_IDS = [
  '94000000-0000-4000-8000-000000000007',
  '94000000-0000-4000-8000-000000000008',
];
const STORAGE_KEYS = ['collaboration-qa-1.png', 'collaboration-qa-2.png'];
const PIN_IDS = [
  '94000000-0000-4000-8000-000000000009',
  '94000000-0000-4000-8000-000000000010',
  '94000000-0000-4000-8000-000000000011',
];
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function run() {
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { role: 'operator' },
    create: {
      id: USER_ID,
      email: 'collaboration-qa@example.test',
      passwordHash: 'qa-session-only',
      role: 'operator',
    },
  });
  await prisma.session.upsert({
    where: { token: 'qa-collaboration-session' },
    update: { userId: USER_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    create: {
      token: 'qa-collaboration-session',
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: { name: 'Collaboration QA Agency' },
    create: { id: WORKSPACE_ID, name: 'Collaboration QA Agency' },
  });
  await prisma.team.upsert({
    where: { id: TEAM_ID },
    update: { name: 'Collaboration QA Client' },
    create: { id: TEAM_ID, workspaceId: WORKSPACE_ID, name: 'Collaboration QA Client' },
  });
  await prisma.teamMember.upsert({
    where: { id: MEMBER_ID },
    update: { userId: USER_ID, email: 'collaboration-qa@example.test', role: 'owner' },
    create: {
      id: MEMBER_ID,
      teamId: TEAM_ID,
      userId: USER_ID,
      email: 'collaboration-qa@example.test',
      role: 'owner',
    },
  });
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: { name: 'Collaboration Transport QA', archivedAt: null, teamId: TEAM_ID },
    create: {
      id: PROJECT_ID,
      name: 'Collaboration Transport QA',
      domain: 'collaboration-qa.example.com',
      apiKey: `mk_${'c'.repeat(40)}`,
      teamId: TEAM_ID,
    },
  });
  await prisma.page.upsert({
    where: { id: PAGE_ID },
    update: { path: '/' },
    create: { id: PAGE_ID, projectId: PROJECT_ID, path: '/' },
  });
  for (let index = 0; index < SCREENSHOT_IDS.length; index += 1) {
    await prisma.screenshot.upsert({
      where: { id: SCREENSHOT_IDS[index] },
      update: { storageKey: STORAGE_KEYS[index], width: 1280, height: 720 },
      create: {
        id: SCREENSHOT_IDS[index],
        pageId: PAGE_ID,
        storageKey: STORAGE_KEYS[index],
        width: 1280,
        height: 720,
      },
    });
    fs.writeFileSync(path.join('/data/screenshots', STORAGE_KEYS[index]), ONE_PIXEL_PNG);
  }
  for (let index = 0; index < PIN_IDS.length; index += 1) {
    await prisma.pin.upsert({
      where: { id: PIN_IDS[index] },
      update: { status: index === 2 ? 'RESOLVED' : 'OPEN' },
      create: {
        id: PIN_IDS[index],
        screenshotId: SCREENSHOT_IDS[index === 2 ? 1 : 0],
        xPercent: 20 + index * 20,
        yPercent: 25 + index * 15,
        authorName: 'QA reviewer',
        status: index === 2 ? 'RESOLVED' : 'OPEN',
      },
    });
  }
  await prisma.presence.deleteMany({ where: { projectId: PROJECT_ID } });
  process.stdout.write(JSON.stringify({ projectId: PROJECT_ID, screenshots: SCREENSHOT_IDS.length, pins: PIN_IDS.length }));
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
