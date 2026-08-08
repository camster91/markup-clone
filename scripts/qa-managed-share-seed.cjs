// This helper runs from the read-only /opt/app-scripts mount. Resolve Prisma
// from the standalone application's runtime rather than this file's directory.
const { PrismaClient } = require('/app/node_modules/@prisma/client');

const databaseUrl = process.env.DATABASE_URL || '';
const dashboardHost = process.env.DASHBOARD_HOST || '';
if (!databaseUrl.includes('@postgres:5432/markup_db') || !dashboardHost.includes('localhost:3030')) {
  throw new Error('Refusing to seed outside the disposable local Compose stack');
}

const prisma = new PrismaClient();
const USER_ID = '91000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '92000000-0000-4000-8000-000000000001';
const TEAM_ID = '92000000-0000-4000-8000-000000000002';
const PROJECT_ID = '93000000-0000-4000-8000-000000000001';

async function run() {
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { role: 'operator' },
    create: {
      id: USER_ID,
      email: 'managed-share-qa@example.test',
      passwordHash: 'qa-session-only',
      role: 'operator',
    },
  });
  await prisma.session.upsert({
    where: { token: 'qa-managed-share-session' },
    update: { userId: USER_ID, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    create: {
      token: 'qa-managed-share-session',
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: {
      name: 'Managed Share Agency',
      brandName: 'Northstar Studio',
      accentColor: '#facc15',
      reviewerWelcome: 'Welcome to your delivery review.',
    },
    create: {
      id: WORKSPACE_ID,
      name: 'Managed Share Agency',
      brandName: 'Northstar Studio',
      accentColor: '#facc15',
      reviewerWelcome: 'Welcome to your delivery review.',
    },
  });
  await prisma.team.upsert({
    where: { id: TEAM_ID },
    update: { name: 'Managed Share Client' },
    create: { id: TEAM_ID, workspaceId: WORKSPACE_ID, name: 'Managed Share Client' },
  });
  await prisma.teamMember.upsert({
    where: { id: '92000000-0000-4000-8000-000000000003' },
    update: { role: 'owner', userId: USER_ID, email: 'managed-share-qa@example.test' },
    create: {
      id: '92000000-0000-4000-8000-000000000003',
      teamId: TEAM_ID,
      userId: USER_ID,
      email: 'managed-share-qa@example.test',
      role: 'owner',
    },
  });
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {
      name: 'Managed Share QA',
      domain: 'managed-share.example.com',
      archivedAt: null,
      shareToken: null,
      shareExpiresAt: null,
      sharePasswordHash: null,
      teamId: TEAM_ID,
    },
    create: {
      id: PROJECT_ID,
      name: 'Managed Share QA',
      domain: 'managed-share.example.com',
      apiKey: `mk_${'q'.repeat(40)}`,
      teamId: TEAM_ID,
    },
  });
  process.stdout.write(JSON.stringify({ projectId: PROJECT_ID, session: true }));
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
