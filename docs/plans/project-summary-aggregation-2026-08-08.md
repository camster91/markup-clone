# Project summary aggregation — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/qa/2026-07-24-production-security-audit.md` M1
**Release boundary:** no schema change; Git, rollback, and production remain approval-gated

## Problem

The dashboard RSC and `/api/projects` polling route select every page,
screenshot, and pin-status row only to calculate four card counts. The response
DTO is compact, but database work and server memory still grow with historical
feedback volume on every overview refresh.

## Outcome

- The authorized project query selects project/card scalars and team identity
  only; it does not hydrate pages, screenshots, pins, comments, or annotations.
- One parameterized PostgreSQL aggregate calculates page, screenshot, total-pin,
  and open-pin counts for only the already-authorized project IDs.
- Projects without pages receive deterministic zero counts.
- RSC first paint and polling API use the same count helper and retain existing
  team scope, archive state, ordering, role redaction, and DTO shape.
- No migration or denormalized counter is introduced, so existing data remains
  authoritative and there is no counter-drift repair burden.

## Verification

- RED/GREEN route and RSC tests reject nested project-list relation selection and
  prove aggregate-derived/zero counts plus role-safe fields.
- Unit tests cover empty inputs and database count normalization.
- A disposable local PostgreSQL project with two screenshots and three pins
  verified the real aggregate in Chromium: the overview rendered `3 pins` and
  `2 open`; overview collaboration remained dormant and the focused-project
  transport assertions stayed green at 375px with no browser errors or overflow.
- Current final-tree Vitest passed 848 tests with 3 intentional skips. ESLint completed
  with zero findings, Prisma validation passed, the production dependency audit
  found zero vulnerabilities, and host and Linux production builds passed.
- Git, npm publication, retained-image rollback, and production deployment were
  not performed and remain approval-gated.
