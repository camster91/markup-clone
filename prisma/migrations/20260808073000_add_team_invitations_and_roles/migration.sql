-- Canonical agency/client roles and hash-only, expiring invitations.
-- Existing reviewer memberships retain the same access under the clearer
-- client role. No membership, user, team, or project row is removed.

ALTER TABLE "TeamMember"
  ADD COLUMN "projectId" TEXT;

UPDATE "TeamMember" SET "role" = 'client' WHERE "role" = 'reviewer';

ALTER TABLE "TeamMember"
  ALTER COLUMN "role" SET DEFAULT 'client',
  ADD CONSTRAINT "TeamMember_role_check"
    CHECK ("role" IN ('owner', 'contributor', 'client', 'guest')) NOT VALID,
  ADD CONSTRAINT "TeamMember_role_project_check"
    CHECK (
      ("role" = 'guest' AND "projectId" IS NOT NULL)
      OR ("role" <> 'guest' AND "projectId" IS NULL)
    ) NOT VALID,
  ADD CONSTRAINT "TeamMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TeamMember_projectId_idx" ON "TeamMember"("projectId");

CREATE TABLE "TeamInvitation" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "projectId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamInvitation_email_check"
    CHECK (char_length("email") BETWEEN 3 AND 320 AND "email" = lower("email")),
  CONSTRAINT "TeamInvitation_role_check"
    CHECK ("role" IN ('owner', 'contributor', 'client', 'guest')),
  CONSTRAINT "TeamInvitation_role_project_check"
    CHECK (
      ("role" = 'guest' AND "projectId" IS NOT NULL)
      OR ("role" <> 'guest' AND "projectId" IS NULL)
    ),
  CONSTRAINT "TeamInvitation_tokenHash_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "TeamInvitation_expiry_check"
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "TeamInvitation_state_check"
    CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL)
);

CREATE UNIQUE INDEX "TeamInvitation_tokenHash_key" ON "TeamInvitation"("tokenHash");
CREATE INDEX "TeamInvitation_teamId_email_idx" ON "TeamInvitation"("teamId", "email");
CREATE INDEX "TeamInvitation_projectId_idx" ON "TeamInvitation"("projectId");
CREATE INDEX "TeamInvitation_expiresAt_idx" ON "TeamInvitation"("expiresAt");
CREATE INDEX "TeamInvitation_invitedByUserId_idx" ON "TeamInvitation"("invitedByUserId");

ALTER TABLE "TeamInvitation"
  ADD CONSTRAINT "TeamInvitation_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TeamInvitation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TeamInvitation_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
