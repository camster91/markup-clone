-- Add internal issue metadata without rewriting or reclassifying legacy pins.
-- The default makes every existing pin explicitly unprioritized.
ALTER TABLE "Pin"
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "assigneeId" TEXT;

ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_priority_check"
  CHECK ("priority" IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'));

CREATE TABLE "Tag" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Tag_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 32),
  CONSTRAINT "Tag_key_length_check" CHECK (char_length("key") BETWEEN 1 AND 32)
);

CREATE TABLE "PinTag" (
  "pinId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,

  CONSTRAINT "PinTag_pkey" PRIMARY KEY ("pinId", "tagId")
);

CREATE INDEX "Pin_assigneeId_idx" ON "Pin"("assigneeId");
CREATE INDEX "Tag_projectId_idx" ON "Tag"("projectId");
CREATE UNIQUE INDEX "Tag_projectId_key_key" ON "Tag"("projectId", "key");
CREATE INDEX "PinTag_tagId_idx" ON "PinTag"("tagId");

ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PinTag"
  ADD CONSTRAINT "PinTag_pinId_fkey"
  FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PinTag"
  ADD CONSTRAINT "PinTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
