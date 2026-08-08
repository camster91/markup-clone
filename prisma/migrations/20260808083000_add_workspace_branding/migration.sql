-- Restrained workspace identity for agency-owned client review surfaces.
-- All fields are nullable so existing workspaces keep the neutral fallback.

ALTER TABLE "Workspace"
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "accentColor" TEXT,
  ADD COLUMN "reviewerWelcome" TEXT,
  ADD CONSTRAINT "Workspace_brandName_check"
    CHECK ("brandName" IS NULL OR char_length("brandName") BETWEEN 1 AND 120),
  ADD CONSTRAINT "Workspace_logoUrl_check"
    CHECK ("logoUrl" IS NULL OR (char_length("logoUrl") <= 2048 AND "logoUrl" ~ '^https://')),
  ADD CONSTRAINT "Workspace_accentColor_check"
    CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "Workspace_reviewerWelcome_check"
    CHECK ("reviewerWelcome" IS NULL OR char_length("reviewerWelcome") BETWEEN 1 AND 280);
