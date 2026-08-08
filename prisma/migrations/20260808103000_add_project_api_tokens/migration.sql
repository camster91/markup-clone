CREATE TABLE "ProjectApiToken" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenLastFour" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'issues:read',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectApiToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectApiToken_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "ProjectApiToken_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ProjectApiToken_prefix_check" CHECK ("tokenPrefix" = 'mkv1_'),
  CONSTRAINT "ProjectApiToken_last_four_check" CHECK ("tokenLastFour" ~ '^[A-Za-z0-9_-]{4}$'),
  CONSTRAINT "ProjectApiToken_scope_check" CHECK ("scope" IN ('issues:read')),
  CONSTRAINT "ProjectApiToken_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "ProjectApiToken_tokenHash_key" ON "ProjectApiToken"("tokenHash");
CREATE INDEX "ProjectApiToken_projectId_createdAt_idx" ON "ProjectApiToken"("projectId", "createdAt");
CREATE INDEX "ProjectApiToken_expiresAt_idx" ON "ProjectApiToken"("expiresAt");
CREATE INDEX "ProjectApiToken_createdById_idx" ON "ProjectApiToken"("createdById");

ALTER TABLE "ProjectApiToken"
ADD CONSTRAINT "ProjectApiToken_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectApiToken"
ADD CONSTRAINT "ProjectApiToken_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
