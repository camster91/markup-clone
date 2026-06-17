-- Migration: add_screenshot_version
-- Per-recapture history. Every successful recapture appends a new
-- ScreenshotVersion row; the Screenshot row stays the "latest pointer"
-- and the ScreenshotVersion rows are the immutable history. Each
-- version carries its own storageKey (a fresh UUID per version) so
-- the captured PNG lives at its own path on disk and the
-- ScreenshotVersion row is self-contained — older versions survive
-- even after the Screenshot's storageKey has been updated to the
-- newest capture.
--
-- The composite index (screenshotId, capturedAt) backs the
-- /api/screenshots/[id]/history query (last 50 ordered by capturedAt
-- desc) without falling back to a sequential scan even when a
-- screenshot has hundreds of versions.
--
-- Cascade: deleting the parent Screenshot deletes all its versions.
-- Screenshot's existing onDelete: Cascade from Page is preserved, so
-- deleting a page also removes its screenshots and all of their
-- versions in one shot.

-- Create the ScreenshotVersion table
CREATE TABLE "ScreenshotVersion" (
    "id" TEXT NOT NULL,
    "screenshotId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "ScreenshotVersion_pkey" PRIMARY KEY ("id")
);

-- storageKey is unique — no two versions may share a path on disk.
-- (Recaptures generate a fresh UUID per version, so collision
-- probability is 2^-122 per pair — well below the "two engineers in
-- the same millisecond" threshold.)
CREATE UNIQUE INDEX "ScreenshotVersion_storageKey_key" ON "ScreenshotVersion"("storageKey");

-- Hot path: GET /api/screenshots/[id]/history returns the last 50
-- versions ordered by capturedAt desc. The composite index makes
-- the lookup an index range scan that also satisfies the ORDER BY
-- without a sort step.
CREATE INDEX "ScreenshotVersion_screenshotId_capturedAt_idx" ON "ScreenshotVersion"("screenshotId", "capturedAt");

-- Cascade: deleting the parent Screenshot removes all its versions.
-- Screenshot's own onDelete: Cascade from Page keeps the chain
-- intact (Page -> Screenshot -> ScreenshotVersion).
ALTER TABLE "ScreenshotVersion"
 ADD CONSTRAINT "ScreenshotVersion_screenshotId_fkey"
    FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
