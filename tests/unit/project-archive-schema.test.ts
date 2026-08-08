import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('reversible project archive persistence', () => {
  it('adds a nullable indexed archivedAt field without changing existing rows', () => {
    const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      resolve('prisma/migrations/20260808093000_add_project_archive/migration.sql'),
      'utf8',
    );

    expect(schema).toContain('archivedAt          DateTime?');
    expect(schema).toContain('@@index([archivedAt])');
    expect(migration).toContain('ADD COLUMN "archivedAt" TIMESTAMP(3)');
    expect(migration).toContain('CREATE INDEX "Project_archivedAt_idx"');
    expect(migration).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });
});
