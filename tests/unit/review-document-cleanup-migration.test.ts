import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = resolve(
  'prisma/migrations/20260828180000_drop_superseded_review_document/migration.sql',
);

describe('superseded ReviewDocument cleanup migration', () => {
  it('is a no-op when the old table is absent and refuses to discard rows', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const refusal = sql.indexOf('RAISE EXCEPTION');
    const drop = sql.indexOf('DROP TABLE "ReviewDocument"');

    expect(sql).toContain(`to_regclass('public."ReviewDocument"') IS NULL`);
    expect(sql).toMatch(/IF EXISTS\s*\(SELECT 1 FROM "ReviewDocument" LIMIT 1\)/);
    expect(refusal).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(refusal);
    expect(sql).not.toMatch(/DROP TABLE "ReviewDocument"\s+CASCADE/i);
  });
});
