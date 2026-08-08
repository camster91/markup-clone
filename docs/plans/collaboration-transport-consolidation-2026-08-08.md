# Collaboration transport consolidation — 2026-08-08

**Status:** complete locally; production untouched
**Parent:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` presence/live-changes capability
**Release boundary:** Git, npm, rollback, and production remain approval-gated

## Problem

The project list mounts `usePresence` once per card, which heartbeats the current
user into every visible project even though they have not opened those projects.
The focused project then mounts one project presence loop and another presence
loop plus SSE connection for every screenshot. The result is inaccurate “online”
state and network/database fan-out proportional to list and screenshot size.

## Outcome

- The list page does not claim the user is present in unopened projects.
- A focused project owns exactly one presence heartbeat/list poll and one SSE
  connection, regardless of screenshot count.
- The focused screenshot/cursor is reported through the project-owned heartbeat.
- Each screenshot receives the shared presence collection and renders only
  cursors whose `screenshotId` matches it.
- Project events trigger one bounded project refresh path; the existing periodic
  detail poll remains the recovery source when SSE is unavailable.
- Public shares remain presence-free and receive no authenticated collaboration
  metadata.

## Verification

- RED/GREEN component and hook tests prove list cards do not open presence
  transports, screenshot count does not multiply transports, cursor activity is
  routed through the project owner, and screenshot filtering remains correct.
- Existing presence route/auth tests, project-detail behavior, accessibility,
  mobile layout, full Vitest, lint, Prisma validation, production build, and
  authenticated desktop/mobile browser QA remain green.

## Completion evidence

- Strict RED/GREEN regressions proved the previous overview heartbeat, three
  unique presence bindings and three SSE bindings for a two-screenshot project,
  missing shared-activity heartbeat data, unbounded event refreshes, and the
  screenshot activity/filter boundary before each fix.
- Current final-tree Vitest passed 848 tests with 3 intentional skips. ESLint completed
  with zero warnings, Prisma validation passed, host and Linux production builds
  passed, and the production dependency audit found zero vulnerabilities.
- Authenticated production-style Chromium at 375px observed zero presence/event
  transports on the overview and, across a full cadence, exactly one SSE stream,
  two heartbeat requests, and two full-TTL presence reads for a two-screenshot
  focused project. The active screenshot and real cursor percentages reached the
  shared heartbeat; the page had no overflow, console errors, or failed requests.
