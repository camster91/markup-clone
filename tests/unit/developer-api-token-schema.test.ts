import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('developer API token persistence', () => {
  it('stores only a hash and safe display metadata with project/user relations', () => {
    const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      resolve('prisma/migrations/20260808103000_add_project_api_tokens/migration.sql'),
      'utf8',
    );
    expect(schema).toContain('model ProjectApiToken');
    expect(schema).toContain('tokenHash   String    @unique');
    expect(schema).not.toMatch(/model ProjectApiToken[\s\S]*?\n}\s*[\s\S]*?plaintextToken/);
    expect(migration).toContain('CREATE TABLE "ProjectApiToken"');
    expect(migration).toContain('"projectId" TEXT NOT NULL');
    expect(migration).toContain('"createdById" TEXT');
    expect(migration).not.toMatch(/"(?:projectId|createdById)" UUID/);
    expect(migration).toContain('ProjectApiToken_scope_check');
    expect(migration).toContain("'issues:read'");
    expect(migration).not.toMatch(/DROP|TRUNCATE/i);
  });
});
