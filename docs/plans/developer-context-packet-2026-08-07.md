# Privacy-bounded developer context packet - 2026-08-07

**Status:** completed locally on 2026-08-07; production deployment remains approval-gated
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`

## Outcome

Turn a client pin into useful implementation context without asking the client
for browser details and without copying credentials, form values, URL query
tokens, console output, or network traffic into the review.

## Initial packet

Each new widget pin may persist:

- canonical page URL limited to HTTP(S), with credentials, query, and fragment
  removed, and a hostname matching the configured project domain;
- validated route/path already owned by the Page row;
- viewport width/height and device pixel ratio with closed numeric bounds;
- bounded user agent and platform strings, rendered as a normalized browser and
  operating-system summary;
- up to five bounded selector candidates using stable id/test/name attributes
  and the existing structural selector;
- a scrubbed, bounded element snippet that removes values and attributes likely
  to carry credentials or session data;
- screenshot id, dimensions, and capture timestamp from the existing immutable
  capture record;
- review-round identity already associated with the Pin.

Console and network capture are explicitly excluded from this slice. They may be
added only behind an off-by-default project setting with field-level scrubbing,
retention limits, and separate security review.

## Access boundary

- Widget callers may submit only the bounded fields above after project-key
  authentication and project-domain validation.
- Operators and owning-team administrators may receive and render the developer
  packet.
- Reviewers and public share links continue to receive the visual issue and
  conversation, but technical selector, element, browser, and environment fields
  are omitted from their DTOs.
- No API key, cookie, storage value, input value, URL query, authorization header,
  console entry, or network body is captured.

## Persistence and compatibility

- Add nullable columns to Pin so all existing feedback remains valid.
- Keep `elementXPath` as the legacy primary selector for compatibility, while
  adding bounded selector candidates as JSON.
- Add database checks mirroring application limits where PostgreSQL can enforce
  them without rewriting existing rows.
- Do not backfill guessed context for old pins; the UI labels missing packets as
  “Not captured for this pin.”

## UI contract

The authenticated administrator pin thread gets a collapsed “Developer context”
section showing URL/route, viewport/DPR, browser/platform, selectors, scrubbed
element snippet, screenshot metadata, and review round. Values are selectable and
the section has a copy action only after the versioned Markdown handoff contract
lands in the following slice.

Reviewer and public-share surfaces do not mount this section.

## Delivery order and proof

1. Add pure validation, canonicalization, user-agent normalization, selector
   parsing, and scrubbed-snippet tests.
2. Add nullable schema fields and a non-destructive migration with database checks.
3. Capture the packet in the widget and validate/persist it at `/api/pins`.
4. Add role-safe DTO serialization and explicit reviewer/public redaction tests.
5. Render the administrator-only context panel with accessible empty/collapsed
   states and component coverage.
6. Run the full automated gates, production/Docker builds, migration preservation
   check, and owner/reviewer browser QA at desktop and mobile widths.

## Non-goals for this slice

- priority, assignee, tags, and issue filters;
- a stable webhook/GitHub issue schema;
- console or network collection;
- copying raw HTML without scrubbing;
- exposing developer metadata through public share tokens.

## Completion evidence

- Added bounded widget capture plus server-side canonicalization, project-domain
  validation, selector parsing, environment normalization, and element scrubbing.
- Added nullable Pin fields and database checks. A disposable pre-migration
  rehearsal preserved a legacy pin and left every new field null rather than
  inventing a backfill.
- Added an administrator-only collapsed context panel. Reviewer and public-share
  DTOs omit legacy selectors/snippets and the new environment packet.
- Browser QA passed at 1280px and 375px for owner and reviewer sessions. The run
  also exposed and fixed a pre-existing share-link hydration mismatch by using a
  stable relative first render and upgrading to an absolute copy URL after
  hydration.
- Final gates: 554 tests passed, 3 skipped; ESLint, TypeScript, Prisma validation,
  production Next.js build, Docker build/migrations/health, and browser console
  checks passed. Existing widget output-directory and disk-media tracing build
  warnings remain unchanged and tracked.
