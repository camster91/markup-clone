# Client/site organization and reversible archive — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` slice 9
**Production:** untouched; deployment remains approval-gated

## Outcome

Make the product's existing hierarchy read the way agencies work:

`agency workspace -> client account -> site -> review round -> page -> issue`

The database already has the correct durable relationships (`Workspace -> Team ->
Project -> ReviewRound`). This slice will not create a competing client or folder
model. It will make those concepts explicit in the UI and add a reversible site
archive so completed work can leave active views without being destroyed.

## Product decisions

- `Workspace` remains the agency/organization boundary.
- `Team` remains the authorization boundary and is presented as a client account.
- `Project` remains the API/domain name and is presented as a site where appropriate.
- `ReviewRound` remains the approval cycle below a site.
- Archiving is reversible and preserves pages, captures, issues, integrations, audit
  history, invitations, and review rounds.
- Active project lists hide archived sites by default. Explicit archive views may
  request archived sites.
- Archived sites remain viewable to authorized members, but new widget pins are
  rejected with specific guidance. Existing history is not deleted.
- Permanent deletion remains an API capability for controlled cleanup, but is removed
  from the primary settings menu so archive is the normal user action.

## Implementation

1. Add nullable `Project.archivedAt` with an additive migration and index.
2. Extend the project list contract with an explicit `state=active|archived|all`
   query. Default to `active`, compose it with the caller's authorization scope, and
   return `archivedAt` in bounded summaries.
3. Extend project PATCH with `archived: boolean`, owner/contributor/operator
   authorization, truthful audit metadata, and idempotent archive/restore semantics.
4. Reject new widget pins for archived sites without invalidating historical dashboard
   or share access.
5. Add active/archive navigation and archive/restore controls. Archived cards are
   deliberately compact and do not start presence or integration polling.
6. Re-label workspace/team/project navigation as agency/client/site language while
   keeping URLs and APIs backward-compatible. Fix the client-creation form's CSRF
   header while touching that flow.
7. Show active and archived site sections on the client-account page to agency admins;
   client reviewers see only active sites in organization lists.

## Verification

- Strict RED/GREEN tests for schema, migration, list filtering, role enforcement,
  widget rejection, UI archive/restore, and role-safe organization pages.
- Full Vitest, TypeScript, lint, Prisma validate, production Next build, and Docker
  production build.
- Fresh-database migration plus legacy-data rehearsal proving existing projects stay
  active (`archivedAt IS NULL`).
- Authenticated browser QA for agency owner, contributor, client, and guest at desktop
  and 320/375px mobile widths, including no overflow or console/network errors.

## Out of scope

- Generic nested folders.
- Moving sites between client accounts.
- Bulk archive, retention automation, or destructive purge UI.
- The supported public SDK/API contract (next slice).

## Completion evidence

- Additive nullable archive migration applied in a fresh 22-migration Docker
  database and rehearsed over an existing site row; the row was preserved,
  `archivedAt` remained null, and the index was created.
- Active-by-default, archived, and all list states are authorization-scoped and
  covered by route tests. Archive/restore is role-gated, reversible, and preserves
  the first archive timestamp.
- Archived sites reject new widget pins with `PROJECT_ARCHIVED`, while authorized
  dashboard history remains available.
- The primary UI now presents agency workspace -> client account -> site -> review
  round, and ordinary site settings use archive instead of permanent deletion.
- Full local gates: 734 tests passed with 3 intentional skips; TypeScript, lint,
  Prisma validation, Next production build, and Docker production build passed.
- Authenticated owner/contributor/client/guest/invitation browser QA passed at
  1280/375/320px. Archive and restore passed with zero console errors, failed
  requests, or horizontal overflow; screenshots were visually inspected.
