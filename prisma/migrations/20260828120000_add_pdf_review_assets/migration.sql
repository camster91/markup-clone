CREATE TABLE "ReviewAsset" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteCount" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewAsset_mime_type_check" CHECK ("mimeType" = 'application/pdf'),
  CONSTRAINT "ReviewAsset_byte_count_check" CHECK ("byteCount" BETWEEN 1 AND 20971520),
  CONSTRAINT "ReviewAsset_page_count_check" CHECK ("pageCount" BETWEEN 1 AND 50)
);

ALTER TABLE "Page"
  ADD COLUMN "reviewAssetId" TEXT,
  ADD COLUMN "assetPageNumber" INTEGER,
  ADD CONSTRAINT "Page_asset_page_number_check"
    CHECK (
      ("reviewAssetId" IS NULL AND "assetPageNumber" IS NULL)
      OR ("reviewAssetId" IS NOT NULL AND "assetPageNumber" BETWEEN 1 AND 50)
    );

CREATE UNIQUE INDEX "ReviewAsset_storageKey_key" ON "ReviewAsset"("storageKey");
CREATE INDEX "ReviewAsset_projectId_createdAt_idx" ON "ReviewAsset"("projectId", "createdAt");
CREATE UNIQUE INDEX "Page_reviewAssetId_assetPageNumber_key" ON "Page"("reviewAssetId", "assetPageNumber");
CREATE INDEX "Page_reviewAssetId_idx" ON "Page"("reviewAssetId");

ALTER TABLE "ReviewAsset"
ADD CONSTRAINT "ReviewAsset_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Page"
ADD CONSTRAINT "Page_reviewAssetId_fkey"
FOREIGN KEY ("reviewAssetId") REFERENCES "ReviewAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
