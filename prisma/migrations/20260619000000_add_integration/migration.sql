-- Migration: add_integration
-- Add the Integration model for outbound webhook notifications.
--
-- When a new pin is created, the POST /api/pins route looks up the
-- project's integrations and fans the pin payload out to each
-- configured target (Slack, Discord, or generic webhook). The
-- dispatch is fire-and-forget — the pin POST does not block on it.
--
-- `kind` is 'slack' | 'discord' | 'webhook'. Stored as a free-form
-- string so we can add a new kind in a single edit; the API + adapter
-- layers enforce the closed set.
--
-- `configJson` is a stringified JSON blob. Shape is kind-specific:
--   - slack:    { webhookUrl: string }
--   - discord:  { webhookUrl: string }
--   - webhook:  { url: string, headers?: Record<string, string> }
-- The POST /api/projects/[id]/integrations route parses + validates
-- the shape per kind, then re-serialises before insert. Storing as a
-- string keeps the contract simple — the dashboard hands the same
-- string back to JSON.parse on read.
--
-- `lastSuccessAt` / `lastError` / `lastErrorAt` track the most recent
-- dispatch outcome. The /api/projects/[id]/integrations/test route
-- updates these on every test ping, and the pin route updates them
-- after every fan-out. The dashboard's ProjectSettings UI surfaces
-- "last success" or "last error" so operators can see at a glance
-- which integrations are healthy.
--
-- Cascade: deleting a project removes every integration. The reverse
-- (an integration surviving its parent project) makes no sense — the
-- adapter would still try to fire at a now-non-existent pin, but the
-- dashboard wouldn't be able to inspect or delete it.

-- Create Integration table
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- Hot path: POST /api/pins looks up "every integration for project X"
-- and the GET /api/projects/[id]/integrations list also filters by
-- projectId. The index keeps both O(log n) as a project accumulates
-- integrations.
CREATE INDEX "Integration_projectId_idx" ON "Integration"("projectId");

-- Cascade: deleting a project removes every integration. The forward
-- cascade is the only one we need — an Integration can only belong
-- to one project, so the reverse is impossible.
ALTER TABLE "Integration"
 ADD CONSTRAINT "Integration_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
