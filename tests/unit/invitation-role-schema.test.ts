import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('invitation claiming and agency role persistence', () => {
  it('models hash-only expiring invitations and project-scoped guests', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('model TeamInvitation');
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/expiresAt\s+DateTime/);
    expect(schema).toMatch(/acceptedAt\s+DateTime\?/);
    expect(schema).toMatch(/revokedAt\s+DateTime\?/);
    expect(schema).toMatch(/invitedByUserId\s+String\?/);
    expect(schema).toMatch(/projectId\s+String\?/);
    expect(schema).toContain('@relation("GuestProjectMembers"');
    expect(schema).toContain('@relation("GuestProjectInvitations"');
  });

  it('uses a data-preserving migration with canonical roles and bounded state', () => {
    const sql = read(
      'prisma/migrations/20260808073000_add_team_invitations_and_roles/migration.sql',
    );
    expect(sql).toContain('CREATE TABLE "TeamInvitation"');
    expect(sql).toContain('ADD COLUMN "projectId" TEXT');
    expect(sql).toContain("UPDATE \"TeamMember\" SET \"role\" = 'client' WHERE \"role\" = 'reviewer'");
    expect(sql).toMatch(/TeamMember_role_check[\s\S]+owner[\s\S]+contributor[\s\S]+client[\s\S]+guest/i);
    expect(sql).toMatch(/TeamMember_role_project_check[\s\S]+role[\s\S]+guest[\s\S]+projectId/i);
    expect(sql).toMatch(/TeamInvitation_tokenHash_check[\s\S]+\{64\}/i);
    expect(sql).toMatch(/TeamInvitation_state_check[\s\S]+acceptedAt[\s\S]+revokedAt/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  });
});
