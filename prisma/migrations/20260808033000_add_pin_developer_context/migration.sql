-- Additive, nullable developer-context packet. Existing pins remain unchanged;
-- no guessed context is backfilled.
ALTER TABLE "Pin"
  ADD COLUMN "pageUrl" TEXT,
  ADD COLUMN "viewportWidth" INTEGER,
  ADD COLUMN "viewportHeight" INTEGER,
  ADD COLUMN "devicePixelRatio" DOUBLE PRECISION,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "selectorCandidatesJson" TEXT;

ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_pageUrl_length_check" CHECK (char_length("pageUrl") <= 2048),
  ADD CONSTRAINT "Pin_viewportWidth_check" CHECK ("viewportWidth" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "Pin_viewportHeight_check" CHECK ("viewportHeight" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "Pin_devicePixelRatio_check" CHECK ("devicePixelRatio" BETWEEN 0.25 AND 10),
  ADD CONSTRAINT "Pin_userAgent_length_check" CHECK (char_length("userAgent") <= 512),
  ADD CONSTRAINT "Pin_platform_length_check" CHECK (char_length("platform") <= 128),
  ADD CONSTRAINT "Pin_selectorCandidates_length_check" CHECK (char_length("selectorCandidatesJson") <= 4000),
  ADD CONSTRAINT "Pin_viewport_pair_check" CHECK (("viewportWidth" IS NULL) = ("viewportHeight" IS NULL));
