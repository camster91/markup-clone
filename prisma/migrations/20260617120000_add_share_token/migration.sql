-- Migration: add_share_token
-- Add an optional opaque shareToken to Project. The token grants read-only
-- access to the public /share/[token] view. NULL = sharing disabled; the
-- /api/projects/[id]/share POST route generates a fresh 32-byte base64url
-- token on each call (rotation invalidates the previous link), and DELETE
-- revokes it. The view is read-only — the widget pin-creation flow is
-- disabled and every load is logged to the audit log.

-- Add the column. Unique constraint is added as a separate step so a
-- NULL value can exist on every project that has not enabled sharing
-- (Postgres allows multiple NULLs in a unique column by default).
ALTER TABLE "Project" ADD COLUMN "shareToken" TEXT;

-- One row per active share link. The token is the lookup key for the
-- /share/[token] page; without the unique constraint, two projects
-- could mint the same token by chance and the lookup would be ambiguous.
ALTER TABLE "Project" ADD CONSTRAINT "Project_shareToken_key" UNIQUE ("shareToken");
