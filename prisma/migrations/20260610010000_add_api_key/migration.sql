-- AlterTable
ALTER TABLE "Project" ADD COLUMN "apiKey" TEXT;
CREATE UNIQUE INDEX "Project_apiKey_key" ON "Project"("apiKey");
