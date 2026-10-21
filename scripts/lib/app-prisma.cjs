// Prisma client for scripts that run inside the app container
// (`docker exec markup-clone node /opt/app-scripts/<script>`).
//
// Prisma 7 connects through a driver adapter; `new PrismaClient()` with no
// options no longer works. Both packages are loaded from the app's own
// node_modules so the scripts use exactly the client the app was built with.
// Keep the options in step with src/lib/prisma.ts.

const { createRequire } = require('node:module');

function createAppPrisma(appEntry = '/app/server.js') {
  const requireFromApp = createRequire(appEntry);
  const { PrismaClient } = requireFromApp('@prisma/client');
  const { PrismaPg } = requireFromApp('@prisma/adapter-pg');
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Prisma 6 gave up on a new connection after 5 s; pg waits forever.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

module.exports = { createAppPrisma };
