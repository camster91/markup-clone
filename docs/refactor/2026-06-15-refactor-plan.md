# Markup-clone refactor plan (June 15, 2026)

The previous review (June 12) found 6 bugs + 3 design
improvements. Most bugs have been fixed in the intervening
sessions. The remaining refactor work is **structural**:
improve the architecture so the product can grow without
rewriting.

This plan is prioritized: P0 = ship-now (small + high impact),
P1 = next sprint, P2 = future. Each item has file:line
evidence, an estimated scope, and a verification recipe.

---

## P0 — ship in this session

### R0.1. Add `?since=<ISO>` to `GET /api/projects` (the dashboard poll)
**File:** `src/app/api/projects/route.ts:7-32` + `src/components/DashboardProjects.tsx:34-44`

The dashboard polls the full project tree every 5s. For
10 projects × 5 pages × 3 screenshots × 20 pins × 2 comments
= ~6,000 rows per response. On a 4G connection this is a
real data drain.

**Fix:** add an optional `?since=<ISO timestamp>` query param.
When set, return only projects/screenshots/pins/comments
updated after that timestamp. The client stores the
lastSuccessful poll timestamp and increments by 1s to avoid
missing same-tick updates.

**Scope:** ~80 LOC. Add a `since` filter to the prisma `where`,
a 1-line guard in the route, a `lastUpdated` setInterval in
DashboardProjects.

**Verification:** `npx vitest run` 220+ pass. New test: after
3 polls 5s apart, the 4th poll with the 3rd-poll's timestamp
returns 0 rows (delta-empty).

### R0.2. Extract the recapture poll loop from `ScreenshotView.tsx` into a `useRecaptureStatus` hook
**File:** `src/components/ScreenshotView.tsx:30-130` (the
`handleRecapture` function and the surrounding state machine)

The recapture logic is 100 lines of useState + useRef +
useEffect + setTimeout chain, with the `stillRendering` flag,
the `mountedRef` cleanup, the `?since=` poll, the
rate-limit headers, and the recapture API call. All of this
is component-specific but well-isolated: it could be a hook
that takes `(screenshotId, onUpdate)` and returns
`{ status, error, isStale, start }`.

**Fix:** extract to `src/lib/hooks/useRecaptureStatus.ts`.
ScreenshotView calls `const { status, error, isStale, start } = useRecaptureStatus(s.id)`.

**Scope:** ~120 LOC moved, ~30 LOC removed from
ScreenshotView (becomes 200 LOC). New tests for the hook in
isolation.

**Why now:** ScreenshotView is at 234 LOC and growing.
Each new feature (auto-stale-detection, server-sent events,
multi-screenshot bulk recapture) would add another 30-50
LOC. Extracting the hook now means each new feature is a
hook variant, not a component edit.

### R0.3. Make `lib/validation.ts` the single source of truth for input shape
**File:** `src/lib/validation.ts` (already 175 LOC) + scattered
inline validators

Currently:
- `subscribers/route.ts:34-42` uses `parsed.data.email` with no format check (the email validation bug from the prior review)
- `prisma/schema.prisma` has column-level length caps that aren't enforced at the route level
- `recapture/route.ts` and `pins/route.ts` each parse the form data with bespoke code

**Fix:** add `validateEmail()`, `validatePinText()`,
`validateSubscriberEmail()`, etc. to `lib/validation.ts`.
Add `validateProjectSubscriber()` (wraps the
parsed.data check). Replace the inline validators in the
routes.

**Scope:** ~50 LOC added to validation.ts, ~30 LOC removed
from 3 routes. New tests.

---

## P1 — next sprint

### R1.1. Extract the `public/widget.js` IIFE into a Vite build with ES modules
**File:** `public/widget.js` (496 LOC, single IIFE)

The widget is 496 lines of one big IIFE. There are 4 distinct
concerns:
- Config: lines 1-26 (read script tag, set up API_URL etc.)
- DOM creation: lines 29-103 (toggle button, hover outline, CSS path)
- Screenshot capture: lines 105-160 (the SVG foreignObject trick)
- Form: lines 165-310 (modal, form, validation, submit)
- Lifecycle: lines 320-490 (DOMContentLoaded, click handler, cleanup)

**Fix:** split into 5 ES modules, build with Vite to a single
self-executing IIFE bundle. The existing tests in
`tests/widget/widget.test.ts` continue to work — they import
from the source files, not the bundle.

**Scope:** ~2 hours. New: `src/widget/`, Vite config,
`src/widget/index.ts` as entry. The 496 LOC file gets
split into 5 files of 50-150 LOC each.

**Why now:** the widget will keep growing (more capture
options, different feedback modes, A/B test variants).
A monolithic IIFE is un-debuggable past 500 LOC.

### R1.2. Add CSRF token for state-changing routes
**File:** `src/lib/auth.ts` (the origin check) +
every state-changing route

The `requireDashboardOrigin` check is the only CSRF
defense today. The prior review's #2.1 noted it's correct
but fragile — removing the sec-fetch-site check would
open the door. Add a CSRF token (double-submit cookie) for
defense in depth.

**Fix:** add `lib/csrf.ts` with `issueCsrfToken(req)` and
`requireCsrfToken(req)`. Issue on every dashboard GET,
verify on every POST/PATCH/DELETE.

**Scope:** ~80 LOC. New tests for the 5 state-changing routes
(POST /projects, PATCH /projects/[id], DELETE /projects/[id],
POST /subscribers, POST /comments, POST /pins).

**Why this sprint:** the current Origin check works in modern
browsers but breaks the day someone removes the sec-fetch-site
check. CSRF tokens are a free hardening.

### R1.3. Split the dashboard into per-project pages
**File:** `src/app/page.tsx` (60 LOC) + `src/components/DashboardProjects.tsx` (151 LOC)

The current dashboard lists all projects + their screenshots +
pins + comments in one big page. This conflates 3 concerns:
project list, project detail, and the per-screenshot pin
thread.

**Fix:** create `src/app/projects/[id]/page.tsx` for the
per-project detail view. The dashboard becomes a list-only
page. Each project is a clickable link.

**Scope:** ~200 LOC new (page + components), ~50 LOC removed
from DashboardProjects. New tests.

**Why this sprint:** the dashboard is the operator's primary
view. Splitting it improves the load-perf (5s poll now only
fetches the project list, not the whole tree) AND clarifies
the navigation. Pairs with R0.1 — once the project list is
the only thing the dashboard polls, the `?since=` is even
more impactful.

---

## P2 — future

### R2.1. Move dashboard to React Server Components
**File:** `src/app/page.tsx` + `DashboardProjects.tsx` (151 LOC)

Currently the whole page is a `'use client'` component that
fetches via useEffect. With RSC, the project list can be
server-rendered and the polling client-side. This:
- Cuts initial page load from 5s (poll round-trip) to <100ms
- Lets Next.js static-render the project list
- Reduces client-side bundle by 30-40%

**Scope:** ~3 hours. Page becomes a server component with
a `<DashboardPoller projects={initialData} />` client
component inside.

**Why future:** this is a bigger architectural change that
requires reworking how state flows from server to client. Not
blocking — current behavior works.

### R2.2. Build a separate `markup-core` package for the validation / auth / rate-limit / audit primitives
**File:** `src/lib/*` (8 files, ~600 LOC)

The 8 lib files have zero project-specific logic — they're
all generic primitives (Zod-style validation, two-tier auth,
in-memory rate limiting, fire-and-forget audit, env-var
parser). If markup ever gets a second product (e.g. a
self-hostable version, or a CLI tool that posts pins), the
primitives should be extractable.

**Scope:** ~4 hours. New `packages/markup-core/` directory,
`tsup` build to dual ESM+CJS, `@markup/core` import path.

**Why future:** premature for a single-app repo. Worth it if
the product line expands.

### R2.3. Playwright e2e for the full widget flow
**File:** `tests/e2e/widget-flow.spec.ts` (new)

JSDOM can't test the SVG foreignObject screenshot trick, real
`elementFromPoint`, or the actual `mousedown → mousemove → mouseup`
click pattern. A Playwright test that loads the dashboard,
clicks the widget on a test page, types feedback, submits,
and verifies the pin shows up in the dashboard is the single
biggest test-coverage gain available.

**Scope:** ~1 day. New: `tests/e2e/widget-flow.spec.ts`,
`playwright.config.ts`, a test fixture page that includes
the widget.

**Why future:** needs the test infrastructure investment
(CI workflow with browser binaries, headless chromium
already in the docker image — verify both).

---

## What's already done (don't redo)

- A-4 widget snippet missing data-project-id (commit 0eba77e)
- A-5 pin coordinates on scrollable pages (commit c4b8112)
- All F1-F5 audit findings (recapture stderr, validateScreenshotId, etc.)
- All G1-G4 audit findings (host/origin parser, email host, comments rate limit, docs refresh)
- All H1-H3 findings (dashboard time, poll timeout, postgres auto-create)

## Critical "do NOT do" items

- Don't touch `scripts/`, `Dockerfile`, `docker-compose.yml`,
  `next.config.ts` in this refactor pass. The deploy plumbing
  is in good shape and not related to the product refactor.
- Don't rename `validateScreenshotId`, `validateProjectDomain`,
  etc. The names are referenced in 12+ files.
- Don't add a new dependency. Vite is already a devDep;
  Playwright would need a separate add. Stay on vitest.
- Don't change the schema. The Pin/Comment/Screenshot/
  Project/Subscriber model is load-bearing for the audit
  trail and dashboard rendering. P2 might revisit, but
  P0/P1 are schema-stable.

## Recommended order

P0 first, all three in this session:
1. R0.1 (the polling) — biggest user-perceived win
2. R0.2 (the hook) — enables faster iteration on ScreenshotView
3. R0.3 (the validation centralization) — fixes the prior
   email bug properly + sets up the next two refactors

P1 next sprint:
- R1.3 (split the dashboard) first, since it sets up R0.1
  nicely
- R1.2 (CSRF token) parallel, independent
- R1.1 (widget Vite build) last, since it's the biggest churn

P2 is "next quarter."
