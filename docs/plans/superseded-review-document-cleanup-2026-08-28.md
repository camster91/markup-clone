# Superseded ReviewDocument cleanup — 2026-08-28

**Status:** merged to `main` after CI and disposable PostgreSQL rehearsal;
exact owner approval and production deployment pending
**Governing roadmap:** `launch-and-saas-replacement-roadmap-2026-08-28.md`

## Context

Production briefly ran `codex/public-onboarding`, whose unmerged migration
`20260813103000_add_review_documents` created `ReviewDocument`. Current code and
`main` use the stricter `ReviewAsset` model instead. Read-only production checks
on 2026-08-28 found both tables present and both empty.

The deployed release therefore has 29 finished Prisma history rows even though
its source contains 28 migration directories. Deleting the history row would
make the audit trail false; leaving the unused table indefinitely would preserve
schema drift.

## Required behavior

Migration `20260828180000_drop_superseded_review_document` must:

1. succeed without mutation when `ReviewDocument` is absent on a fresh database;
2. drop `ReviewDocument` only when it exists and has no rows;
3. raise an exception before the drop when any row exists;
4. omit `CASCADE` so an unexpected dependent object also stops the migration;
5. run through `scripts/apply-migration.sh`, keeping the schema change and Prisma
   history marker in one fail-fast transaction.

## Evidence

- A unit contract asserts the absence check, row guard, refusal-before-drop
  ordering, and lack of a cascading drop.
- A disposable PostgreSQL 16 rehearsal passed all three database paths:
  absent table no-op, empty table removal, and nonempty table refusal with the
  legacy row preserved.

## Production exit gate

Immediately before an approved deployment, confirm `ReviewDocument` still has
zero rows and retain the normal private backup plus immutable rollback image.
After deployment, verify the table is absent, the cleanup migration is finished,
the application is healthy, and public-release verification still passes.

Production will then have 30 finished history rows: the 28 migrations in the
deployed launch release, the historical superseded migration, and this cleanup.
A fresh database will have 29 rows because it never received the superseded
migration; both histories truthfully describe their own path.

## Merge and release staging evidence

- Pull request #43 passed Ashbi Local CI and GitGuardian against exact head
  `9dae91753f67834ccd882f410c23240e1a787b07`.
- It merged without bypass as
  `a03b87d8d05db0a69b050c75d05baf383d611fea` on 2026-08-28.
- Immediately after merge, production still had zero `ReviewDocument` rows and
  29 finished migrations; the healthy app still ran the prior exact release.
- Rollback-image, edge/TLS, public-health, and exact-checkout public-release
  preflights passed.
- Fresh backup `markup-20260828T191950Z.dump` passed remote catalog/checksum
  verification and its mode-0600 off-host copy passed SHA-256 verification at
  `dbe4f2ebbf07f9ddda02b5b38a9a6280972c3ccf06d6c1d739a6fedf1a781518`.

These facts prove release readiness, not production deployment. The release
remains at the explicit owner-approval boundary.
