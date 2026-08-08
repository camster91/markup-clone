import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('developer context persistence', () => {
  it('adds only nullable compatibility-safe fields to Pin', () => {
    const schema = read('prisma/schema.prisma');
    for (const [field, type] of [['pageUrl', 'String'], ['viewportWidth', 'Int'], ['viewportHeight', 'Int'], ['devicePixelRatio', 'Float'], ['userAgent', 'String'], ['platform', 'String'], ['selectorCandidatesJson', 'String']]) {
      expect(schema).toMatch(new RegExp(`\\b${field}\\s+${type}\\?`));
    }
  });

  it('uses an additive migration with closed bounds and no data rewrite', () => {
    const sql = read('prisma/migrations/20260808033000_add_pin_developer_context/migration.sql');
    expect(sql).toContain('ADD COLUMN "pageUrl" TEXT');
    expect(sql).toContain('CHECK ("viewportWidth" BETWEEN 1 AND 10000)');
    expect(sql).toContain('CHECK ("devicePixelRatio" BETWEEN 0.25 AND 10)');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE "Pin"/i);
  });
});
