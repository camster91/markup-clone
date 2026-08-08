-- Add a durable transactional outbox and delivery-attempt history without
-- rewriting existing integrations. Existing rows have no signing secret until
-- an operator recreates or explicitly rotates a generic webhook.
ALTER TABLE "Integration"
  ADD COLUMN "signingSecret" TEXT;

ALTER TABLE "Integration"
  ADD CONSTRAINT "Integration_signingSecret_length_check"
  CHECK ("signingSecret" IS NULL OR char_length("signingSecret") = 43);

CREATE TABLE "IntegrationEvent" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "schema" TEXT NOT NULL DEFAULT 'visual-feedback.event.v1',
  "type" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationEvent_schema_check" CHECK ("schema" = 'visual-feedback.event.v1'),
  CONSTRAINT "IntegrationEvent_type_length_check" CHECK (char_length("type") BETWEEN 1 AND 100),
  CONSTRAINT "IntegrationEvent_payload_length_check" CHECK (char_length("payloadJson") BETWEEN 2 AND 100000)
);

CREATE TABLE "IntegrationDelivery" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryCycle" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationDelivery_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'DEAD_LETTER')),
  CONSTRAINT "IntegrationDelivery_attemptCount_check" CHECK ("attemptCount" BETWEEN 0 AND 5),
  CONSTRAINT "IntegrationDelivery_retryCycle_check" CHECK ("retryCycle" >= 0),
  CONSTRAINT "IntegrationDelivery_lastError_length_check" CHECK (char_length("lastError") <= 1000),
  CONSTRAINT "IntegrationDelivery_lockedBy_length_check" CHECK (char_length("lockedBy") <= 100)
);

CREATE TABLE "IntegrationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "cycle" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "responseStatus" INTEGER,
  "error" TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationDeliveryAttempt_attemptNumber_check" CHECK ("attemptNumber" BETWEEN 1 AND 5),
  CONSTRAINT "IntegrationDeliveryAttempt_cycle_check" CHECK ("cycle" >= 0),
  CONSTRAINT "IntegrationDeliveryAttempt_status_check"
    CHECK ("status" IN ('SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTER')),
  CONSTRAINT "IntegrationDeliveryAttempt_error_length_check" CHECK (char_length("error") <= 1000),
  CONSTRAINT "IntegrationDeliveryAttempt_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE INDEX "IntegrationEvent_projectId_createdAt_idx"
  ON "IntegrationEvent"("projectId", "createdAt");
CREATE UNIQUE INDEX "IntegrationDelivery_integrationId_eventId_key"
  ON "IntegrationDelivery"("integrationId", "eventId");
CREATE INDEX "IntegrationDelivery_status_nextAttemptAt_idx"
  ON "IntegrationDelivery"("status", "nextAttemptAt");
CREATE INDEX "IntegrationDelivery_integrationId_createdAt_idx"
  ON "IntegrationDelivery"("integrationId", "createdAt");
CREATE UNIQUE INDEX "IntegrationDeliveryAttempt_deliveryId_cycle_attemptNumber_key"
  ON "IntegrationDeliveryAttempt"("deliveryId", "cycle", "attemptNumber");
CREATE INDEX "IntegrationDeliveryAttempt_deliveryId_startedAt_idx"
  ON "IntegrationDeliveryAttempt"("deliveryId", "startedAt");

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationDelivery"
  ADD CONSTRAINT "IntegrationDelivery_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationDelivery"
  ADD CONSTRAINT "IntegrationDelivery_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "IntegrationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationDeliveryAttempt"
  ADD CONSTRAINT "IntegrationDeliveryAttempt_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "IntegrationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
