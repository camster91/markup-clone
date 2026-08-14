-- Retain the opaque original PDF while rendered pages continue to use
-- the shared Page/Screenshot review model.
CREATE TABLE "ReviewDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewDocument_storageKey_key" ON "ReviewDocument"("storageKey");
CREATE INDEX "ReviewDocument_projectId_createdAt_idx" ON "ReviewDocument"("projectId", "createdAt");

ALTER TABLE "ReviewDocument" ADD CONSTRAINT "ReviewDocument_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
