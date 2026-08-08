import { createRequire } from 'node:module';
import { access, unlink } from 'node:fs/promises';
import {
  assertDisposableComposeEnvironment,
} from './lib/load-harness.mjs';
import {
  LOAD_API_KEY,
  LOAD_PROJECT_ID,
  cleanupLoadFixture,
  seedLoadFixture,
} from './lib/load-fixture.mjs';

assertDisposableComposeEnvironment(
  process.env.DATABASE_URL ?? '',
  process.env.DASHBOARD_HOST ?? '',
);

const action = process.argv[2];
if (action !== 'seed' && action !== 'cleanup') {
  throw new Error('Usage: node local-load-fixture.mjs <seed|cleanup>');
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient();

try {
  if (action === 'seed') {
    await seedLoadFixture(prisma);
    process.stdout.write(JSON.stringify({
      action,
      projectId: LOAD_PROJECT_ID,
      apiKey: LOAD_API_KEY,
    }));
  } else {
    const result = await cleanupLoadFixture(
      prisma,
      unlink,
      access,
      process.env.SCREENSHOTS_DIR ?? '/data/screenshots',
    );
    process.stdout.write(JSON.stringify({ action, ...result }));
  }
} finally {
  await prisma.$disconnect();
}
