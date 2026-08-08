-- Record the project that owns each attachment. The column is nullable so
-- legacy orphan rows remain intact; all new uploads require a project id.
ALTER TABLE "Attachment" ADD COLUMN "projectId" TEXT;

-- Bound legacy attachments can be backfilled through their comment chain.
UPDATE "Attachment" AS attachment
SET "projectId" = page."projectId"
FROM "Comment" AS comment
JOIN "Pin" AS pin ON pin."id" = comment."pinId"
JOIN "Screenshot" AS screenshot ON screenshot."id" = pin."screenshotId"
JOIN "Page" AS page ON page."id" = screenshot."pageId"
WHERE attachment."commentId" = comment."id";

CREATE INDEX "Attachment_projectId_idx" ON "Attachment"("projectId");

ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
