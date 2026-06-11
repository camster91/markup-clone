import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };

// Standard Next.js dev-mode singleton pattern. Prisma 6 picks up DATABASE_URL
// from the process env automatically. The previous lazy-proxy version was
// over-engineered and broke under Prisma 6's new driver-adapter requirement
// (the empty options object in `new PrismaClient({})` was the trigger).
export const prisma = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
