-- Optional controls for managed public review links. Existing links remain
-- active, unprotected, and non-expiring after this additive migration.
ALTER TABLE "Project"
  ADD COLUMN "shareExpiresAt" TIMESTAMP(3),
  ADD COLUMN "sharePasswordHash" TEXT;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_share_settings_require_token"
  CHECK (
    "shareToken" IS NOT NULL
    OR ("shareExpiresAt" IS NULL AND "sharePasswordHash" IS NULL)
  ),
  ADD CONSTRAINT "Project_share_password_hash_length"
  CHECK ("sharePasswordHash" IS NULL OR char_length("sharePasswordHash") <= 512);
