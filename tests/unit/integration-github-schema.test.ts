import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migrationPath = path.join(
  root,
  'prisma/migrations/20260808063000_add_native_github_delivery/migration.sql',
);

describe('native GitHub delivery schema', () => {
  it('stores encrypted credentials and bounded external issue references', () => {
    expect(schema).toMatch(/credentialCiphertext\s+String\?/);
    expect(schema).toMatch(/externalId\s+String\?/);
    expect(schema).toMatch(/externalUrl\s+String\?/);

    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('ADD COLUMN "credentialCiphertext" TEXT');
    expect(sql).toContain('ADD COLUMN "externalId" TEXT');
    expect(sql).toContain('ADD COLUMN "externalUrl" TEXT');
    expect(sql).toMatch(/credentialCiphertext[^;]+char_length[^;]+2000/i);
    expect(sql).toMatch(/externalId[^;]+char_length[^;]+200/i);
    expect(sql).toMatch(/externalUrl[^;]+char_length[^;]+500/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
