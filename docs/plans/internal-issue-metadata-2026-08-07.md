# Internal issue metadata and filters - 2026-08-07

**Status:** completed locally 2026-08-08; production remains approval-gated
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`

## Outcome

Give agencies a fast internal triage layer for visual feedback without turning
the client review into a project-management screen. Owners/operators can set
priority, assign a claimed team member, apply reusable project tags, and filter
the review. Reviewers and public-share viewers remain focused on the visual
issue, conversation, resolution, and sign-off.

## Data model

- Pin gets `priority` with closed values `NONE`, `LOW`, `MEDIUM`, `HIGH`, and
  `URGENT`; existing rows migrate to `NONE` so no historical urgency is guessed.
- Pin gets nullable `assigneeId` referencing User with `SET NULL` on user delete.
- Project owns reusable Tag rows with bounded display name plus a canonical
  lowercase key unique within the project.
- PinTag joins Pin and Tag with a composite unique key and cascading cleanup.
- Database checks enforce the priority set and bounded tag names/keys.

## Authorization and validation

- Existing status-only PATCH behavior remains available to authorized project
  reviewers.
- Any priority, assignee, or tag mutation additionally requires project-owner or
  global-operator authorization.
- An assignee must be a claimed User on the project team. Pending email-only
  members, users from another team, and assignees on legacy unscoped projects are
  rejected.
- Tags are normalized, deduplicated, bounded to five per pin, and created only in
  the pin's project transaction.
- Audit metadata records changed field names and identifiers, not comment bodies
  or secrets.

## Role-safe read contract

- Owner/operator project detail includes each pin's priority, safe assignee
  identity, tags, plus project-scoped assignee/tag filter options.
- Reviewer and public DTOs omit all internal issue metadata and options rather
  than returning redacted names that could still reveal agency workflow.
- The versioned handoff gains these fields only from the already-authorized admin
  Pin object; its schema identifier remains v1 because the fields were explicitly
  reserved as nullable/optional within v1.

## UI contract

- The owner pin thread shows a compact “Internal issue details” editor with
  priority, assignee, comma-separated tags, explicit save state, and actionable
  errors.
- A project-level filter bar supports status, priority, assignee (including
  unassigned), and tag. Filters combine with AND semantics and show “X of Y”.
- Empty results explain how to clear filters. Filter controls are keyboard-native
  and remain usable at 320px without horizontal overflow.
- Reviewer/public surfaces mount neither editor nor filter bar.

## Delivery order and proof

1. Add failing schema/migration tests and implement the additive migration.
2. Add failing pure validation and filtering tests, then implement helpers.
3. Add failing route authorization/transaction tests and implement PATCH support.
4. Add failing role-safe DTO tests and serialize owner-only metadata/options.
5. Add failing editor/filter component tests and implement the owner UI.
6. Extend the Markdown handoff from owner-visible data and verify redaction.
7. Run full automated gates, production/Docker build, migration preservation, and
   authenticated owner/reviewer desktop/mobile/keyboard browser QA.

## Non-goals

- external GitHub/webhook delivery;
- due dates, estimates, sprint planning, or task dependencies;
- assigning pending invitations or users outside the project team;
- exposing internal triage metadata to client reviewers or public links.

## Closure evidence - 2026-08-08

- Added an additive migration for closed priority, nullable assignment,
  project-scoped reusable tags, and unique pin/tag membership. A legacy pin
  survived a real pre/post-migration rehearsal as `NONE`, unassigned, with zero
  tags; database checks rejected `BLOCKER` and an empty tag.
- The pin PATCH boundary preserves reviewer status updates but requires an owner
  or operator for internal fields. Assignment is limited to claimed users on the
  project's team; tag replacement is normalized, bounded, project-scoped, and
  atomic.
- Owner/operator DTOs and UI expose issue metadata and filter options. Reviewer
  and public-share payload tests prove priority, assignee identity, tags, and
  filter options are omitted.
- Project filters cover status, priority, assignee/unassigned, and tag with AND
  semantics, result counts, a clear action, and an explained zero-result state.
  The pin thread provides native priority/assignee controls, bounded tags, save
  feedback, and refreshed project totals.
- `visual-feedback.issue.v1` now carries a bounded internal-workflow block in the
  already administrator-only Markdown handoff.
- Verified 588 tests passed and 3 skipped; ESLint, TypeScript, Prisma validation,
  production Next.js build, Docker build/migration/health, and authenticated
  owner/reviewer browser flows passed at 1280, 375, and 320 pixels. Keyboard save,
  exact role redaction, clipboard content, AND filtering, zero horizontal
  overflow, zero console errors, and zero unexpected failed requests were
  asserted directly.
