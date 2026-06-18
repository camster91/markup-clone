-- Migration: add_attachments
-- Image attachments on comments. The first feature surfaces screenshots
-- pasted from the dashboard reviewer's clipboard into the PinThread reply
-- form, but the `kind` column accepts 'image' | 'voice' | 'video' so
-- voice / video follow-ups can be added without a migration.
--
-- The API layer (POST /api/attachments) currently only accepts 'image';
-- the column is a free-form string (NOT a Prisma enum) so adding a new
-- kind is a single-edit change in the validator.
--
-- Cascade: deleting the parent Comment removes its attachments. The
-- Comment → Pin → Screenshot → Page → Project chain keeps the rest of
-- the cascade clean (a deleted project removes every page, every
-- screenshot, every pin, every comment, and every attachment).

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    -- commentId is nullable so the upload can land BEFORE the
    -- comment is created. The dashboard's paste handler POSTs
    -- the attachment, gets back an id, then POSTs the comment
    -- with the matching attachmentIds in the same batch. The
    -- Comment.create route's `connect: [{ id }]` binds the
    -- orphan attachment to the new comment in one shot.
    "commentId" TEXT,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- storageKey is unique so a GET /api/attachments/[id] probe can't
-- accidentally collide with another attachment (and so a misuse in
-- the POST route that re-uses a UUID can't double-write a file).
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- commentId index backs the Comment→Attachment include used by the
-- /api/projects tree and the /share/[token] view: a single index
-- range scan returns all attachments for a comment in storageKey
-- order (or createdAt order, which is the same on UUIDs).
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");

-- AddForeignKey
ALTER TABLE "Attachment"
 ADD CONSTRAINT "Attachment_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "Comment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
