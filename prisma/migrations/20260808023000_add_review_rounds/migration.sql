-- Additive review workflow foundation. Existing projects and pins remain valid
-- with NULL active/review round ids until an owner creates the first round.
CREATE TABLE "ReviewRound" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "commentsPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReviewRound_status_check" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'ARCHIVED')),
    CONSTRAINT "ReviewRound_number_check" CHECK ("number" > 0),
    CONSTRAINT "ReviewRound_name_length_check" CHECK (char_length("name") <= 120)
);

CREATE TABLE "ReviewSignOff" (
    "id" TEXT NOT NULL,
    "reviewRoundId" TEXT NOT NULL,
    "userId" TEXT,
    "signerEmail" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewSignOff_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReviewSignOff_note_length_check" CHECK (char_length("note") <= 1000)
);

ALTER TABLE "Project" ADD COLUMN "activeReviewRoundId" TEXT;
ALTER TABLE "Pin" ADD COLUMN "reviewRoundId" TEXT;

CREATE UNIQUE INDEX "Project_activeReviewRoundId_key" ON "Project"("activeReviewRoundId");
CREATE UNIQUE INDEX "ReviewRound_projectId_number_key" ON "ReviewRound"("projectId", "number");
CREATE INDEX "ReviewRound_projectId_createdAt_idx" ON "ReviewRound"("projectId", "createdAt");
CREATE UNIQUE INDEX "ReviewSignOff_reviewRoundId_userId_key" ON "ReviewSignOff"("reviewRoundId", "userId");
CREATE INDEX "ReviewSignOff_userId_idx" ON "ReviewSignOff"("userId");
CREATE INDEX "Pin_reviewRoundId_idx" ON "Pin"("reviewRoundId");

ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_activeReviewRoundId_fkey"
  FOREIGN KEY ("activeReviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_reviewRoundId_fkey"
  FOREIGN KEY ("reviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewSignOff" ADD CONSTRAINT "ReviewSignOff_reviewRoundId_fkey"
  FOREIGN KEY ("reviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSignOff" ADD CONSTRAINT "ReviewSignOff_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
