-- Migration: add_annotation
-- Add Annotation model for free-form drawings (arrow / box / freehand) on
-- top of the screenshot. Stored as JSON path data (pathJson) so we can
-- extend per-kind shapes without a migration.
--
-- The Pin relation is one-to-many: deleting a pin cascades to its
-- annotations. Annotations are NOT on Screenshot — different pins on the
-- same screenshot can carry their own drawings without collision.
--
-- Coordinates are image-px (the screenshot's natural pixel space), not
-- viewport-px — see the schema.prisma comment on `Annotation` for the
-- full coordinate-space contract.

-- Create the Annotation table
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pathJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- Hot path: the dashboard's ScreenshotView reads annotations grouped by
-- pinId. A btree index on pinId makes that lookup constant-time per pin
-- and keeps the listing query from falling back to a sequential scan.
CREATE INDEX "Annotation_pinId_idx" ON "Annotation"("pinId");

-- Cascade: deleting a pin deletes its annotations. The reverse is
-- impossible (annotations belong to exactly one pin) so we only need the
-- forward cascade.
ALTER TABLE "Annotation"
 ADD CONSTRAINT "Annotation_pinId_fkey"
    FOREIGN KEY ("pinId") REFERENCES "Pin"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
