-- Drop old data (this is a breaking restructure; no production data to preserve)
-- Comment table changes: remove proposedCode, pullRequestUrl, xPercent, yPercent, xpath, screenSize
-- Add Pin model: reparent the comment threads under Pin, with screenshot+pin position

-- Step 1: Drop old Comment table (data is being restructured)
DROP TABLE IF EXISTS "Comment" CASCADE;

-- Step 2: Create Screenshot table
CREATE TABLE "Screenshot" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- Step 3: Create Pin table
CREATE TABLE "Pin" (
  "id" TEXT NOT NULL,
  "screenshotId" TEXT NOT NULL,
  "xPercent" DOUBLE PRECISION NOT NULL,
  "yPercent" DOUBLE PRECISION NOT NULL,
  "elementXPath" TEXT,
  "elementHTML" TEXT,
  "authorName" TEXT NOT NULL DEFAULT 'Client',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Pin_pkey" PRIMARY KEY ("id")
);

-- Step 4: Create new Comment table (parented to Pin)
CREATE TABLE "Comment" (
  "id" TEXT NOT NULL,
  "pinId" TEXT NOT NULL,
  "author" TEXT NOT NULL DEFAULT 'Client',
  "authorRole" TEXT NOT NULL DEFAULT 'client',
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- Step 5: Indexes
CREATE UNIQUE INDEX "Screenshot_storageKey_key" ON "Screenshot"("storageKey");
CREATE INDEX "Screenshot_pageId_idx" ON "Screenshot"("pageId");
CREATE INDEX "Pin_screenshotId_idx" ON "Pin"("screenshotId");
CREATE INDEX "Comment_pinId_idx" ON "Comment"("pinId");

-- Step 6: Foreign keys
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
