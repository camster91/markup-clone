# Role-aware project notifications — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` notifications row
**Release boundary:** additive migration; Git, external mail, rollback, and production remain approval-gated

## Problem

Notification behavior is split between an administrator-managed list of raw
email addresses, unconditional registered-user mention mail, and durable
integration delivery. Project members cannot see or control their own email
preferences, ordinary thread replies are silent, and workflow status or
assignment changes do not reach the people responsible for the review.

## Outcome

- Each authenticated project member owns one project-scoped preference row;
  no user can read or change another member's settings.
- The UI offers role-aware recommended presets for agency operators,
  contributors, clients, and guests while requiring an explicit save. Existing
  installs do not silently subscribe every member to new mail.
- Preferences cover new feedback, thread replies, workflow status changes,
  assignments, and direct mentions. Existing mention mail remains on until a
  user explicitly opts out; other member notifications are opt-in.
- New-pin, reply, status-change, assignment, and mention dispatch respects the
  saved preference, excludes the actor where identity is known, and deduplicates
  recipients. Legacy external subscribers remain supported and are clearly
  labeled as external new-feedback alerts.
- Member notifications use the workspace's reviewer-facing brand identity and
  a project/deep-link target without exposing API keys, share tokens, integration
  secrets, internal subscriber lists, or password hashes.
- Delivery stays best-effort and non-blocking for the product action. Mailgun
  failures cannot roll back feedback; no real email is sent during local QA.

## Data and access boundary

- Add a legacy-safe `ProjectNotificationPreference` relation keyed uniquely by
  `(projectId, userId)` with explicit booleans for the five event classes.
- Project and user deletion cascade to preferences. Access uses
  `assertProjectAccessible`; GET/PATCH always derive `userId` from the session.
- PATCH accepts only the closed boolean field set and is CSRF protected.

## Verification

- Strict RED/GREEN tests for self-only API access, defaults/recommendations,
  validation, persistence, event recipient filtering, actor/duplicate exclusion,
  mention opt-out compatibility, branded escaped email output, and UI states.
- Apply all migrations to disposable PostgreSQL and verify clean plus upgrade
  paths without contacting Mailgun.
- Run full Vitest, ESLint, Prisma validation, dependency audit, host/Linux
  production builds, then authenticated owner/client desktop/mobile/keyboard
  browser QA with request and console assertions.

## Completion evidence

- Strict RED/GREEN coverage proved safe defaults, agency/client recommendations,
  closed input validation, self-only access, response redaction, recipient access
  revalidation, actor/target filtering, mention opt-out compatibility, cross-channel
  deduplication, and fallback member delivery when legacy subscriber lookup fails.
- Upgraded the disposable local database from 25 to 26 migrations and applied all
  26 from zero to a separate temporary database. Direct PostgreSQL checks proved
  the boolean defaults and user-delete cascade; the temporary database was removed
  and the fixture mutation was rolled back.
- Final-tree Vitest passed 848 tests with 3 intentional skips. ESLint completed
  with zero findings, Prisma validation passed, the production dependency audit
  found zero vulnerabilities, and host plus Linux production builds passed.
- Authenticated production-style Chromium verified operator and client presets,
  explicit persistence, body-user-ID injection rejection, API redaction/no-store,
  keyboard focus, and the 375px layout with zero overflow or browser errors. No
  Mailgun request was made. Visual inspection found no layout or hierarchy issue.
- Git, npm publication, retained-image rollback, and production deployment were
  not performed and remain approval-gated.
