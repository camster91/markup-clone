-- Production briefly received ReviewDocument from an unmerged implementation.
-- Current code uses ReviewAsset. Fresh databases never had the superseded table,
-- while upgraded production databases may still have it.
DO $review_document_cleanup$
BEGIN
  IF to_regclass('public."ReviewDocument"') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM "ReviewDocument" LIMIT 1) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'object_not_in_prerequisite_state',
      MESSAGE = 'Refusing to drop superseded ReviewDocument because it contains data';
  END IF;

  -- Deliberately omit CASCADE: any unexpected dependent object must stop the
  -- migration instead of being removed implicitly.
  DROP TABLE "ReviewDocument";
END
$review_document_cleanup$;
