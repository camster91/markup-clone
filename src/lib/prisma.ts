import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaD1?: PrismaClient;
};

function sqlitePathFromEnv(): string {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  if (url.startsWith('file:')) {
    return path.resolve(url.slice('file:'.length));
  }
  // CI used to pass a PostgreSQL placeholder for generate only. Never open that
  // as a sqlite file — fall back to a local dev database.
  return path.resolve('dev.db');
}

function createSqliteClient(): PrismaClient {
  const dbPath = sqlitePathFromEnv();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function tryCloudflareD1(): PrismaClient | undefined {
  try {
    // Sync context is available during a Worker request.
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext: (opts?: { async?: boolean }) => { env?: { DB?: ConstructorParameters<typeof PrismaD1>[0] } };
    };
    const { env } = getCloudflareContext();
    if (!env?.DB) return undefined;
    return new PrismaClient({
      adapter: new PrismaD1(env.DB),
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  } catch {
    return undefined;
  }
}

function getClient(): PrismaClient {
  const d1 = tryCloudflareD1();
  if (d1) {
    g.prismaD1 ??= d1;
    return g.prismaD1;
  }
  g.prisma ??= createSqliteClient();
  return g.prisma;
}

export async function getPrisma(): Promise<PrismaClient> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const db = (env as { DB?: ConstructorParameters<typeof PrismaD1>[0] } | undefined)?.DB;
    if (db) {
      g.prismaD1 ??= new PrismaClient({
        adapter: new PrismaD1(db),
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      });
      return g.prismaD1;
    }
  } catch {
    // Local Next.js, tests, and scripts have no Cloudflare context.
  }
  return getClient();
}

// Keep a `prisma` export so existing route and test mocks stay stable.
// The proxy defers client construction until the first property access,
// when a Worker request context (and the D1 binding) is available.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
