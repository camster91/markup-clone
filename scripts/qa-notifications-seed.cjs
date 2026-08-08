const { PrismaClient } = require('/app/node_modules/@prisma/client');

const databaseUrl = process.env.DATABASE_URL || '';
const dashboardHost = process.env.DASHBOARD_HOST || '';
if (!databaseUrl.includes('@postgres:5432/markup_db') || !dashboardHost.includes('localhost:3030')) {
  throw new Error('Refusing to seed notifications outside the disposable local Compose stack');
}

const prisma = new PrismaClient();
const PROJECT_ID = '94000000-0000-4000-8000-000000000005';
const WORKSPACE_ID = '94000000-0000-4000-8000-000000000002';
const TEAM_ID = '94000000-0000-4000-8000-000000000003';
const CLIENT_ID = '95000000-0000-4000-8000-000000000001';
const CLIENT_MEMBER_ID = '95000000-0000-4000-8000-000000000002';

async function run() {
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID }, select: { id: true } });
  if (!project) throw new Error('Run qa-collaboration-seed.cjs before notification QA');

  await prisma.workspace.update({
    where: { id: WORKSPACE_ID },
    data: { brandName: 'Northstar Studio', accentColor: '#4f46e5' },
  });
  await prisma.user.upsert({
    where: { id: CLIENT_ID },
    update: { email: 'notification-client@example.test', role: 'reviewer' },
    create: {
      id: CLIENT_ID,
      email: 'notification-client@example.test',
      passwordHash: 'qa-session-only',
      role: 'reviewer',
    },
  });
  await prisma.teamMember.upsert({
    where: { id: CLIENT_MEMBER_ID },
    update: { userId: CLIENT_ID, email: 'notification-client@example.test', role: 'client', projectId: null },
    create: {
      id: CLIENT_MEMBER_ID,
      teamId: TEAM_ID,
      userId: CLIENT_ID,
      email: 'notification-client@example.test',
      role: 'client',
    },
  });
  await prisma.session.upsert({
    where: { token: 'qa-notification-client-session' },
    update: { userId: CLIENT_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    create: {
      token: 'qa-notification-client-session',
      userId: CLIENT_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.projectNotificationPreference.deleteMany({
    where: { projectId: PROJECT_ID, userId: { in: [
      '94000000-0000-4000-8000-000000000001',
      CLIENT_ID,
    ] } },
  });
  process.stdout.write(JSON.stringify({ projectId: PROJECT_ID, clientId: CLIENT_ID }));
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
