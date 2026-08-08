-- Add encrypted provider credentials and safe external delivery references.
-- All columns are nullable so existing integrations and delivery history remain valid.
ALTER TABLE "Integration"
  ADD COLUMN "credentialCiphertext" TEXT,
  ADD CONSTRAINT "Integration_credentialCiphertext_length_check"
    CHECK ("credentialCiphertext" IS NULL OR char_length("credentialCiphertext") <= 2000);

ALTER TABLE "IntegrationDelivery"
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalUrl" TEXT,
  ADD CONSTRAINT "IntegrationDelivery_externalId_length_check"
    CHECK ("externalId" IS NULL OR char_length("externalId") <= 200),
  ADD CONSTRAINT "IntegrationDelivery_externalUrl_length_check"
    CHECK ("externalUrl" IS NULL OR char_length("externalUrl") <= 500);
