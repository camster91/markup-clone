import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('review-default persistence', () => {
  it('adds legacy-safe constrained defaults to client accounts', () => {
    const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(resolve('prisma/migrations/20260808113000_add_team_review_defaults/migration.sql'), 'utf8');
    expect(schema).toContain('reviewRoundNameTemplate');
    expect(schema).toContain('reviewRoundCommentsPaused');
    expect(migration).toContain('Review round {n}');
    expect(migration).toContain('Team_review_round_template_check');
    expect(migration).not.toMatch(/DROP|TRUNCATE/i);
  });
});
