-- Migration: add_workspaces_teams
-- Multi-tenant team workspaces (org → teams → projects).
--
-- Adds three tables — Workspace, Team, TeamMember — and a nullable
-- teamId FK on Project. The team layer is ADDITIVE: every existing
-- project pre-dates this change, and the migration does NOT back-fill
-- teamId, so an install upgrading from a pre-workspace version keeps
-- every existing project as `teamId = NULL` (treated as "legacy /
-- unscoped" by the GET filter). The dashboard's existing
-- single-project view continues to work for the transitional
-- single-team install.
--
-- Cascade policy (encoded by the FK declarations):
--   - Workspace → Team   : Cascade (deleting a workspace removes its teams)
--   - Team → TeamMember   : Cascade (deleting a team removes its members)
--   - Team → Project      : RESTRICT (a team with active projects must
--                           not be silently destroyed; the route returns
--                           a P2003 conflict and the dashboard surfaces
--                           "move or delete projects first")
--   - TeamMember → User   : Cascade (deleting a user removes their
--                           memberships)
--   - User → TeamMember   : SetNull would orphan rows; Cascade is the
--                           right shape for "user left the platform"

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Team_workspaceId_idx" ON "Team"("workspaceId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- AddForeignKey: Team → Workspace (Cascade on delete).
ALTER TABLE "Team"
ADD CONSTRAINT "Team_workspaceId_fkey"
   FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
   ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: TeamMember → Team (Cascade on delete).
ALTER TABLE "TeamMember"
ADD CONSTRAINT "TeamMember_teamId_fkey"
   FOREIGN KEY ("teamId") REFERENCES "Team"("id")
   ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: TeamMember → User (Cascade on delete, nullable).
-- ON DELETE SET NULL would orphan the member row; the API layer
-- rejects deleting a User with memberships, so this never fires in
-- practice. Cascade matches the relationship in the model file.
ALTER TABLE "TeamMember"
ADD CONSTRAINT "TeamMember_userId_fkey"
   FOREIGN KEY ("userId") REFERENCES "User"("id")
   ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn: Project.teamId (nullable, RESTRICT on delete).
-- The migration does NOT back-fill teamId — every pre-existing
-- project has teamId = NULL, which the GET filter treats as
-- "legacy / unscoped" and only shows to callers with no team
-- memberships (the transitional single-project dashboard behaviour).
ALTER TABLE "Project"
ADD COLUMN "teamId" TEXT;

-- AddForeignKey: Project → Team (RESTRICT on delete).
-- A team with active projects must not be silently destroyed.
-- The /api/workspaces/[id]/teams/[teamId] DELETE route checks for
-- projects first and returns 409 with a clear message; the FK is
-- the belt-and-suspenders backup.
ALTER TABLE "Project"
ADD CONSTRAINT "Project_teamId_fkey"
   FOREIGN KEY ("teamId") REFERENCES "Team"("id")
   ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddIndex: Project.teamId. Backs the GET /api/projects filter
-- "projects whose team is one the caller is a member of" — the
-- IN-clause on teamId would otherwise be a sequential scan when a
-- workspace has hundreds of projects.
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");
