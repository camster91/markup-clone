-- Migration: add_presence
-- Add Presence model for multi-user collaboration (collab card).
-- One row per (userId, projectId); lastSeenAt is bumped on every heartbeat
-- so a 60s TTL filters out disconnected reviewers from the "online" list.
--
-- The `userId` is a client-generated UUID (localStorage) for now; F10 will
-- add a real User model + session and migrate the column to a real FK.
-- We do NOT add a FK on userId today precisely because there is no User
-- table — and we don't want a forward-only FK to nothing.

-- Create Presence table
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "screenshotId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursorX" DOUBLE PRECISION,
    "cursorY" DOUBLE PRECISION,
    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- One row per (userId, projectId) — the heartbeat route does an upsert
-- on this compound key. Without it, two tabs of the same user would each
-- create their own row and the "online users" list would double-count.
CREATE UNIQUE INDEX "Presence_userId_projectId_key" ON "Presence"("userId", "projectId");

-- Hot path: "list online users for this project". The (projectId, lastSeenAt)
-- index keeps that query off a full table scan even with thousands of
-- historical rows.
CREATE INDEX "Presence_projectId_lastSeenAt_idx" ON "Presence"("projectId", "lastSeenAt");

-- Foreign key to Project (with cascade delete — a deleted project takes
-- its presence rows with it). screenshotId is intentionally a plain
-- string with NO foreign key: F2/SSE may reference a screenshot that was
-- captured in the same heartbeat, and we don't want a hard link to the
-- Screenshot row today (and Screenshot deletion is itself a CASCADE from
-- Page/Project so the screenshotId could in principle point to a
-- row that no longer exists).
ALTER TABLE "Presence"
 ADD CONSTRAINT "Presence_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
