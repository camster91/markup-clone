import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const g = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 connects through a driver adapter (node-postgres) instead of the
// Rust query engine. Keep the options in step with scripts/lib/app-prisma.cjs,
// which builds the same client for scripts run inside the container.
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Prisma 6 gave up on a new connection after 5 s; pg waits forever.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

// Standard Next.js dev-mode singleton pattern.
export const prisma = g.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
