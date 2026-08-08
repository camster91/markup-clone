ALTER TABLE "Project"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");
