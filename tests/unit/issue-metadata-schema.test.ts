import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('internal issue metadata persistence', () => {
  it('models legacy-safe priority, nullable assignment, and project-scoped reusable tags', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/priority\s+String\s+@default\("NONE"\)/);
    expect(schema).toMatch(/assigneeId\s+String\?/);
    expect(schema).toContain('model Tag');
    expect(schema).toContain('model PinTag');
    expect(schema).toContain('@@unique([projectId, key])');
    expect(schema).toContain('@@id([pinId, tagId])');
  });

  it('uses an additive migration with closed priority and bounded tags', () => {
    const sql = read('prisma/migrations/20260808043000_add_internal_issue_metadata/migration.sql');
    expect(sql).toContain('ADD COLUMN "priority" TEXT NOT NULL DEFAULT \'NONE\'');
    expect(sql).toContain('ADD COLUMN "assigneeId" TEXT');
    expect(sql).toContain('CREATE TABLE "Tag"');
    expect(sql).toContain('CREATE TABLE "PinTag"');
    expect(sql).toContain('CHECK ("priority" IN (\'NONE\', \'LOW\', \'MEDIUM\', \'HIGH\', \'URGENT\'))');
    expect(sql).toContain('CHECK (char_length("name") BETWEEN 1 AND 32)');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE "Pin"/i);
  });
});
