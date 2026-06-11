-- Migration: add_subscribers
-- Add Subscriber model for email notifications on new pins

-- Create Subscriber table
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- Add foreign key to Project (with cascade delete)
ALTER TABLE "Subscriber"
 ADD CONSTRAINT "Subscriber_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint: no duplicate email per project
CREATE UNIQUE INDEX "Subscriber_projectId_email_key" ON "Subscriber"("projectId", "email");

-- Add subscribers relation to Project model (handled by Prisma client, no migration needed for the back-reference)
