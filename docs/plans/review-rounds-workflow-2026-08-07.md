# Review rounds, status, sign-off, and feedback pausing — 2026-08-07

**Status:** completed locally; production release remains approval-gated
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`

## Outcome

An agency owner can open a named review round, control its status, pause new
feedback while retaining replies to existing threads, and collect attributable
reviewer sign-offs. Every new pin is associated with the active round so later
rounds do not erase the history of why earlier feedback was created.

## Domain model

### ReviewRound

- belongs to exactly one Project;
- has a monotonically increasing project-local `number` and optional name;
- uses the closed statuses `DRAFT`, `IN_REVIEW`, `CHANGES_REQUESTED`,
  `APPROVED`, and `ARCHIVED`;
- stores `commentsPaused`, lifecycle timestamps, and creator identity;
- is selected through `Project.activeReviewRoundId` rather than an ambiguous
  “latest active row” query;
- owns zero or more sign-offs and pins.

### ReviewSignOff

- belongs to one ReviewRound and one authenticated User;
- is unique per `(reviewRoundId, userId)`;
- stores an optional bounded note and timestamp;
- can be withdrawn by its author or an authorized project administrator;
- never treats a public share capability as an identity.

### Pin association

`Pin.reviewRoundId` is nullable for migration compatibility. New widget pins use
the project's active round when one exists. Existing legacy pins remain valid
and are presented as “Before review rounds.”

## Authorization

- Read rounds/sign-offs: authenticated project members and global operators.
- Create rounds, rename, change status, pause/resume, archive: project admins
  only through `assertProjectAdmin`.
- Sign off: any authenticated project member with project access.
- Withdraw sign-off: its author or a project admin.
- Public share links remain read-only and do not impersonate a reviewer.

## Feedback-pausing invariant

Pausing applies only to creating new pins. Existing threads remain readable and
authenticated reviewers may continue replying. `/api/pins` checks the active
round after project-key authentication and returns `409` with a stable error
code when new feedback is paused. The server boundary is authoritative; widget
UI messaging is a secondary convenience.

## API surface

- `GET /api/projects/[id]/review-rounds`
- `POST /api/projects/[id]/review-rounds`
- `PATCH /api/projects/[id]/review-rounds/[roundId]`
- `POST /api/projects/[id]/review-rounds/[roundId]/sign-offs`
- `DELETE /api/projects/[id]/review-rounds/[roundId]/sign-offs/[signOffId]`

Responses use bounded DTOs. No project API key, share token, webhook config, or
unrelated user record is serialized.

## UI contract

The project detail page gets a Review workflow section above the page captures:

- active round number/name and status;
- progress summary: open issues, resolved issues, and sign-off count;
- admin controls for status and pause/resume;
- reviewer action to sign off with an optional note or withdraw their sign-off;
- explicit paused messaging: “New pins are paused; replies remain open.”

Administrative controls stay unmounted for reviewers. The reviewer view keeps
implementation details and credentials hidden.

## Delivery order and proof

1. ~~Add schema, migration, closed validators, and serializer tests.~~
   Completed locally on 2026-08-07.
2. ~~Add role-enforced round and sign-off APIs with audit entries.~~
   Completed locally on 2026-08-07.
3. ~~Attach new pins to the active round and enforce paused-new-pin behavior.~~
   Completed locally on 2026-08-07.
4. ~~Add the project Review workflow UI with loading/error/empty states.~~
   Completed locally on 2026-08-07.
5. ~~Add widget paused messaging based on the stable API error.~~
   Completed locally on 2026-08-07.
6. ~~Run full tests, Prisma validation, lint, typecheck, production/Docker builds,
   and authenticated owner/reviewer browser QA.~~ Completed locally on
   2026-08-07.

## Migration and rollback safety

- New foreign keys are nullable where required for existing data.
- No existing project, pin, comment, or screenshot is rewritten or deleted.
- The initial migration does not silently create rounds for every project;
  owners opt into the first round explicitly.
- Rolling back the application leaves the additive tables/columns unused and
  preserves all existing feedback data.

## 2026-08-07 implementation checkpoint

- Added the `ReviewRound` and `ReviewSignOff` models, nullable legacy-safe pin
  association, and an explicit project active-round relation through an additive
  migration with no destructive statements.
- Added closed status parsing, transition rules, and bounded round-name/sign-off
  note sanitizers with regression coverage.
- New pins inherit the active review round. A paused active round rejects only
  new pin creation with HTTP 409 and stable code `NEW_FEEDBACK_PAUSED`, before
  page or attachment state is written.
- Verified the production migration against the existing disposable QA database:
  one existing project and one existing pin were preserved, with zero synthetic
  review rounds created. Both application and database healthchecks passed.
- Verified: full Vitest suite (518 passed, 3 skipped), ESLint, TypeScript, Prisma
  validation/generation, and the production Next.js build. Management APIs and
  UI remain deliberately unclaimed.

### Management and reviewer experience checkpoint

- Added bounded authenticated round listing, owner/operator creation and updates,
  reviewer sign-off/upsert, and author-or-admin withdrawal routes. Every write is
  CSRF-protected and audited; reviewer controls never mount in the admin surface.
- Only the explicit active round may be updated or signed. Historical rounds are
  immutable through these endpoints, and archiving the active round clears the
  project pointer.
- Added the project Review workflow surface with loading, failure/retry, empty,
  active, paused, sign-off, withdrawal, and past-round states. Owner status/pause
  controls and reviewer approval are separated by the server-provided role flag.
- The embedded website widget recognizes `NEW_FEEDBACK_PAUSED`, retains the typed
  draft, re-enables Save, and explains that replies to existing threads remain
  open instead of displaying a raw HTTP payload.
- Added database checks for the closed status set, positive round numbers, and
  the documented name/note limits.
- Verified: full Vitest suite (533 passed, 3 skipped), ESLint, TypeScript, Prisma
  validation/generation, and production Next.js build. Authenticated owner and
  reviewer browser QA was still pending at this checkpoint.

### Browser and container closure

- Rebuilt the production Docker image and applied the migration from an empty
  database. Both application and PostgreSQL healthchecks passed.
- At 375px, an authenticated operator created “Launch review,” changed it from
  Draft to In review, and paused new pins. The workflow had zero horizontal
  overflow, zero controls outside the viewport, and no workflow console errors.
- At 320px, an authenticated reviewer saw the active/paused state, no API key,
  no status selector, and no pause control; they signed off with “Ready to build”
  and received the withdrawal action. The page had zero horizontal overflow,
  zero controls outside the viewport, and no console errors.
- Browser QA exposed a discoverability defect: reviewers had a linked project
  title but no explicit action. Added and re-verified a visible “Open review”
  link while retaining secret/admin redaction.
- Final full regression: 533 tests passed and 3 Windows shell checks skipped.
  The disposable QA accounts, project, database, screenshots, containers, and
  network were removed afterward.
