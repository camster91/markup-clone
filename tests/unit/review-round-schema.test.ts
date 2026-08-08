import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('review round persistence', () => {
  it('models an explicit active round, attributable sign-offs, and legacy-safe pin association', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('activeReviewRoundId String?');
    expect(schema).toContain('model ReviewRound');
    expect(schema).toContain('model ReviewSignOff');
    expect(schema).toContain('@@unique([projectId, number])');
    expect(schema).toContain('@@unique([reviewRoundId, userId])');
    expect(schema).toMatch(/reviewRoundId\s+String\?/);
  });

  it('uses an additive migration with no destructive statements', () => {
    const sql = read('prisma/migrations/20260808023000_add_review_rounds/migration.sql');
    expect(sql).toContain('CREATE TABLE "ReviewRound"');
    expect(sql).toContain('CREATE TABLE "ReviewSignOff"');
    expect(sql).toContain('ADD COLUMN "reviewRoundId" TEXT');
    expect(sql).toContain('CHECK ("status" IN');
    expect(sql).toContain('CHECK (char_length("name") <= 120)');
    expect(sql).toContain('CHECK (char_length("note") <= 1000)');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  });
});
