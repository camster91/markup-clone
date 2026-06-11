import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  if (globalForPrisma.prisma) {
    _prisma = globalForPrisma.prisma;
    return _prisma;
  }
  // Prisma 7 requires explicit options. In production, the app supplies
  // a driver adapter via env-driven setup. For now, construct lazily
  // so module import (e.g. Next.js page data collection) doesn't fail
  // when no DB is configured (CI builds, type-checking).
  //
  // TODO: switch to a real driver adapter (@prisma/adapter-pg) using
  // DATABASE_URL once the rest of the app's runtime config is sorted.
  _prisma = new PrismaClient({});
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = _prisma;
  return _prisma;
}

// Lazy proxy: defer PrismaClient construction until first use.
// Allows `import { prisma } from './prisma'` to succeed in any context
// (build, type-check, runtime). Real DB queries will still throw if
// no adapter is configured, but that's a runtime concern, not a build one.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
