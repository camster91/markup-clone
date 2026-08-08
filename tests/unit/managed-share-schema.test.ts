import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('managed public review link schema', () => {
  it('adds expiry and a server-only password hash with an additive migration', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260808123000_add_managed_share_links/migration.sql',
      'utf8'
    );

    expect(schema).toMatch(/shareExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/sharePasswordHash\s+String\?/);
    expect(migration).toContain('ADD COLUMN "shareExpiresAt" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "sharePasswordHash" TEXT');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
