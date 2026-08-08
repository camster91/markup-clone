ALTER TABLE "Team"
  ADD COLUMN "reviewRoundNameTemplate" TEXT NOT NULL DEFAULT 'Review round {n}',
  ADD COLUMN "reviewRoundCommentsPaused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_review_round_template_check"
  CHECK (
    char_length("reviewRoundNameTemplate") BETWEEN 3 AND 120
    AND "reviewRoundNameTemplate" LIKE '%{n}%'
    AND "reviewRoundNameTemplate" !~ '[[:cntrl:]]'
  );
