# TASK.md — markup-clone task board

**Last updated:** 2026-08-08 (production release and rollback verified; see
`docs/plans/agency-product-release-2026-08-07.md`).

**Format:** each item has a status (`shipped`, `ready`, `blocked`,
`parked`), a one-line description, and the source — git commit SHA
for shipped, source-of-truth for the rest.

**Read order for new agents:**

1. Pick from the `ready` column. Don't invent work.
2. Check the `shipped` column before assuming something isn't done.
   Several features the marketing copy / earlier plans mention are
   already on `main` — confirm before re-implementing.
3. `blocked` items need the listed unblock before they can move.

---

## In progress

### Agency product release — Gate 0 security and correctness
- **Status:** in-progress · **Source:**
  `docs/plans/agency-product-release-2026-08-07.md`
- **Completed slice:** anonymous dashboard/project rendering is closed;
  project/workspace/team reads are scoped; administration and membership
  changes enforce operator/team-owner roles; attachment/media access is
  project-scoped; shared media, hydration, origin handling, dependency audit,
  local Docker migrations, role-safe project administration, reviewer secret
  redaction, team-detail navigation, bounded project-list DTOs, and the first
  accessibility/responsive remediation pass are green.
- **Completed slice:** first-party MarkUp.io parity matrix and agency/developer
  product wedge; dashboard/detail polling now exposes an actionable offline retry
  state without discarding the last good review data.
- **Completed slice:** detail-page keyboard journey, modal/thread focus return,
  history retry, announced route loading, semantic main landmarks, accurate
  product metadata, and live 320/375px browser verification.
- **Completed slice:** additive review-round/sign-off schema and migration,
  closed status/transition validation, active-round pin association, and
  server-enforced pause-new-feedback behavior. Existing comments remain open.
- **Completed slice:** role-enforced round/status/sign-off APIs, an owner/reviewer
  review workflow UI, historical-round immutability, and specific paused-feedback
  guidance in the website widget without discarding the draft.
- **Completed slice:** authenticated owner/reviewer review-round browser QA at
  375/320px, plus the reviewer dashboard’s explicit “Open review” entry point.
- **Completed slice:** privacy-bounded widget context capture and persistence,
  admin-only developer context UI, reviewer/public redaction, legacy-data-safe
  migration, and authenticated owner/reviewer QA at 1280/375px. The QA pass also
  fixed a share-link hydration mismatch.
- **Completed slice:** deterministic `visual-feedback.issue.v1` payload,
  injection-safe copyable Markdown, admin-only clipboard workflow, and exact-pin
  dashboard URLs with owner/reviewer desktop/mobile/keyboard QA.
- **Completed slice:** owner-only priority, claimed-team assignment, reusable
  project tags, AND filters, role-safe DTOs, and enriched developer handoff with
  legacy-data migration and owner/reviewer 1280/375/320 browser QA.
- **Completed slice:** versioned integration events, transactionally durable
  delivery, HMAC-signed generic webhooks, bounded automatic retries,
  dead-letter history, and owner-only manual retry/activity UI with local
  worker, migration, desktop/mobile, and reviewer-redaction verification.
- **Completed slice:** native GitHub issue delivery with explicit repository and
  labels, encrypted repository-scoped credentials, read-only connection tests,
  deterministic developer handoff, stable-marker retry deduplication, safe
  external issue links, and owner/reviewer desktop/mobile verification.
- **Completed slice:** expiring/revocable hash-only invitations, invite acceptance
  for existing or new accounts, canonical owner/contributor/client/guest roles,
  project-scoped guest access, last-owner protection, and role-redacted team UI.
- **Completed slice:** validated operator-owned workspace branding, contrast-safe
  branded invitations, and a simplified role-redacted client/guest review mode.
- **Completed slice:** reversible site archive, active-by-default scoped lists,
  widget archive enforcement, and agency -> client -> site -> review-round
  information architecture with desktop/mobile browser verification.
- **Completed slice:** separate hash-only server developer tokens, a documented
  versioned read-only issue API, and a typed dependency-free browser SDK with
  explicit widget lifecycle/events, clean/upgrade migration verification, and
  authenticated desktop/mobile browser QA.
- **Completed slice:** reusable client-account review defaults, warning-free
  production builds, PostgreSQL 16-pinned guarded backup/restore with a completed
  local recovery drill, operational runbooks, fresh 24-migration Linux build,
  and combined owner/client/API/SDK browser QA.
- **Completed slice:** expiring and optional-password public review links,
  token-bound HttpOnly media access, private shared-media caching, no
  token-bearing media URLs, agency-branded unlock, clean 25-migration install,
  and desktop/mobile/keyboard browser verification. See
  `docs/plans/managed-public-review-links-2026-08-08.md`.
- **Completed slice:** removed false list-page presence and consolidated the
  focused project to one presence loop and one SSE connection regardless of
  screenshot count, with shared cursor routing, bounded event refreshes, and
  authenticated 375px transport-count QA. See
  `docs/plans/collaboration-transport-consolidation-2026-08-08.md`.
- **Completed slice:** replaced overview page/screenshot/pin row hydration with
  a single scoped aggregate while preserving the role-safe project-card DTO. See
  `docs/plans/project-summary-aggregation-2026-08-08.md`.
- **Completed slice:** added self-service, role-aware project notification
  preferences and preference-respecting feedback/reply/workflow/assignment/mention
  email dispatch while preserving clearly labeled external alerts. See
  `docs/plans/role-aware-notifications-2026-08-08.md`.
- **Completed production slice:** normalized the content-identical script-mode
  drift, replaced the self-signed Traefik certificate with ACME-managed trusted
  TLS, committed and pushed the release, applied all 26 migrations, deployed the
  exact SHA image, passed public/cross-browser/widget QA, and exercised rollback
  plus forward recovery. Production now runs `ce998ae`; npm remains unpublished.
- **Blocked release slice:** production has zero user accounts. Provision the
  first operator after Cameron supplies the exact email and password, then run
  authenticated owner/client production QA before declaring the full goal shipped.
- **Completed local evidence slice:** added a loopback-only multipart
  pin-ingestion load rehearsal with explicit latency/error thresholds and
  verified cleanup. The measured 24-request/concurrency-6 run passed at 157ms
  p95 with 24/24 HTTP 201 responses. See
  `docs/plans/local-pin-ingestion-load-rehearsal-2026-08-08.md`.
- **Completed local evidence slice:** repaired the non-executing widget E2E
  fixture and the blob-SVG canvas taint that prevented real screenshot uploads;
  then verified the real built widget, recapture, keyboard/focus, 44px controls,
  and 320px responsive behavior across Chromium, Firefox, and WebKit. See
  `docs/plans/cross-browser-widget-and-accessibility-qa-2026-08-08.md`.
- **Completed local evidence slice:** read-only production inventory confirmed
  that the healthy live container's immutable source-SHA image is retained.
  Deploys now fail closed before migrations if that tag is mutable, missing,
  invalid, or retargeted, and record a private rollback manifest. Dirty release
  source is also refused so a build cannot be mislabeled with a commit SHA. Six
  executable contract tests cover the preflight and ordering behavior.
- The pre-audit checkpoint passed 881 tests with 3 intentional skips,
  warning-free ESLint, Bash syntax checks, host/Linux production builds, and a
  matching read-only retained-image plus live-health recheck.
- **Completed local evidence slice:** audited the full release worktree, excluded
  test reports from source/image contexts, enforced LF shell scripts, inventoried
  all API guards and migrations, and replaced suppressed migration errors with
  atomic fail-fast application. Releases now require an authenticated Git
  fast-forward and reject tarball/marker provenance. Read-only production checks
  found Git access healthy and one mode-only dirty-tree blocker; production was
  not modified.
- **Completed local evidence slice:** aligned deployment with the verified
  Traefik edge. The release now skips legacy Caddy processes/config, validates a
  trusted public certificate before migrations and after startup, retires the
  obsolete Caddy cron in Traefik mode, and no longer changes tracked script modes.
  Pre-release read-only production verification correctly failed on the
  then-active self-signed Markup certificate; no live repair was attempted in
  that slice.
- **Current final-tree evidence:** 899 tests passed with 3 intentional skips;
  ESLint is warning-free; Prisma validates; the production dependency audit has
  zero vulnerabilities; all 26 migrations pass from an empty database; and the
  host build, exact Linux image build, and isolated image health/hash probe pass.
- **Release evidence:** failing regression tests before each fix; targeted
  suites, full Vitest, lint, Prisma validation, production build, and browser
  QA before Gate 0 is marked shipped.

---

## 🚀 Ready (pick from here)

### Complete the core MarkUp-style SaaS journey
- **Status:** in progress · **Source:** `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`
- **Completed local slice:** project administrators can edit or delete scoped
  comments with dashboard authentication, CSRF, rate limiting, audit evidence,
  and owner/client browser coverage. Image review uploads are the active next
  slice.
- **Boundary:** GitHub, repository access, and AI delivery are parked; they are
  not part of the MarkUp SaaS release path.

### Ship the AI-agent integration (README §"Future work")
- **Status:** parked · **Source:** README §"Future work"
- **Description:** "generate-fix flow, GitHub PR creation." This is
  the natural Phase 5 capstone. No code yet. Subsystems needed:
  - LLM client wrapper (probably `src/lib/ai/`).
  - Repo-pipeline integration (use the `repo-pipeline` skill from
    `~/.hermes/skills/repo-pipeline/`).
  - Dashboard UI for "Generate fix" on a pin / comment thread.
  - Audit log entries for `ai.generate-fix.start` / `ai.pr.opened`.
- **Verify before starting:** confirm no in-progress work in
  `src/lib/` for `ai-` or `agent-` named modules. Confirm no draft
  design doc in `docs/`.
- **Risk:** New external dependency (LLM API). Bundle size impact —
  per `CLAUDE.md` "no new dependencies without `npm run build`."

### Per-site sitemap.xml + OG defaults
- **Status:** ready · **Source:** claimed in prior report; not on main
- **Description:** Each project gets `/api/projects/[id]/sitemap.xml`
  + per-route OG image defaults. The widget URL pattern is
  `?project=<id>&page=<id>` so sitemap discovery needs a manifest
  endpoint too.
- **Verify before starting:** `grep -r sitemap src/` should return
  nothing; `grep -r 'og:image' src/` should be empty or stale.
- **Risk:** Per-site means per-project multi-tenant — read
  `src/lib/teams.ts` for the existing scoping pattern before
  duplicating.

### Form webhooks outbound (`/api/projects/[id]/integrations/webhook`)
- **Status:** partially shipped · **Source:** claimed in prior report
- **Description:** Subsystem exists at `src/lib/integrations/`
  (webhook/discord/slack) but only the `Integration` model + types
  in `prisma/schema.prisma`. No UI, no per-form-submit dispatch.
- **Verify before starting:** read `src/lib/integrations/dispatcher.ts`
  to see what's wired vs stub.
- **Risk:** Medium — touches the integrations system that
  `@mentions` and subscriber notifications also depend on.

### Pluggable auth providers
- **Status:** ready · **Source:** README §"Future work" implies auth
  is project-key + dashboard-origin only; no SSO/OAuth.
- **Description:** Add OAuth (Google + GitHub) for the dashboard.
  Sessions are already wired (see `model Session` in `prisma/schema.prisma`).
- **Risk:** Auth changes are high-blast-radius. Per memory: no
  silent auth changes — open a PR, get review.

---

## ✅ Shipped (don't re-implement)

The following were claimed as Phase 5 work in prior reports but are
already on `main`. Cross-reference `git log` to confirm — listed by
the merge commit / PR that landed each:

### F1–F3 (recapture + screenshots)
- Annotation tool selector (arrow/box/freehand) — F3 part 2
- `validateScreenshotId` on recapture + status routes (audit F3)
- Screenshot polling abort on unmount (audit F5)
- Rate-limit on `/api/screenshots/[id]/status` (audit F4)
- Lightweight poll endpoint (width/height/capturedAt) instead of
  full project tree

### F4–F5 (events + SSE)
- SSE endpoint at `/api/events`
- In-memory pub-sub for live pin/comment/recapture updates
- Dashboard hook consumes the SSE stream

### F6 (audit / dashboard polish)
- Audit log surfaced at `/api/audit`
- Real-time relative time format ("Updated X ago")
- Origin parser unification (D5)

### F7 (comments)
- Image attachments (paste from clipboard)
- `@mentions` in comments + email notification
- Comment thread opens the screenshot view scrolled to the new
  comment (`#comment-<id>` URL fragment)
- Comment create rate-limit (audit D8)

### F8 (integrations outbound)
- Slack / Discord / generic webhook outbound integrations
- Per-project integration config
- Validation + dispatch with retry

### F9 (multi-tenant teams)
- Workspace → Team → Member hierarchy (see `model Workspace`,
  `model Team`, `model TeamMember` in `prisma/schema.prisma`)
- `src/lib/teams.ts` for the team scoping helpers

### P2.2 (extracted `@markup/core` package)
- Shared widget primitives extracted into `packages/markup-core`
- Vite build for the widget bundle (`src/widget/`)
- ES module split (was a 496-LOC IIFE; now 5 files)

### Other
- Per-user identity with email + password (see `model User` +
  `model Session` + `src/lib/auth.ts`)
- Public read-only project share links with revoke (`/api/projects/[id]/share`)
- Recapture screenshot version history (`model ScreenshotVersion`)
- PATCH / DELETE 404s on missing records (audit 2026-06-17)

### Production security audit — Critical/High client + media (branch `cursor/production-security-audit-4eb8`)
- **Status:** shipped · **Commit:** `0930aef`
- DashboardPoller delta upsert-by-id (empty delta no longer wipes list)
- Presence GET always full TTL list (dropped `?since=`)
- Removed client-side `audit()` from `useRecaptureStatus`
- Login: cookie-only session token, IP/email rate limit, CSRF cookie
- `dashboardHeaders()` sends CSRF double-submit header
- Screenshot `/image` + `/history` gated (dashboard origin OR `?share=`)
- Home/share pages redact `apiKey` for anonymous / public viewers
- NewProjectForm try/catch/finally around create fetch

### Production security audit — dashboard API gates (branch `cursor/production-security-audit-4eb8`)
- **Status:** shipped · **Commit:** `76d22ec`
- `requireDashboardAuth` + CSRF on dashboard writes across projects,
  pins, comments, annotations, attachments, workspaces, presence,
  screenshots recapture
- `assertProjectAccessible` + `validateProjectId` on project-scoped routes
- Integration list redacts webhook URLs / headers in `configJson`
- Outbound integration URLs: `validateOutboundUrlShape` at write time;
  `assertSafeOutboundUrl` + `redirect: 'error'` before fetch
- Attachments reject `image/svg+xml` (png/jpeg/gif/webp only)
- Presence POST derives `userId` from session (ignores client spoof)

---

## 🚧 Blocked

### Tailwind 4.3.3 patch bump
- **Status:** shipped (#22, merged 2026-07-23) — was blocked on
  Dependabot auto-merge, resolved by manual `gh pr merge --squash`
  (CI billing issue on this private repo).

### `/api/comments` validation + auth
- **Status:** shipped (already on `main`) — was reported as #4 P1 on
  GitHub, but the file path in the issue (`src/app/api/comments/`)
  doesn't exist; the actual route is
  `src/app/api/pins/[id]/comments/` and has full auth + validation
  + rate-limit + sanitisation + audit. Issue can be closed as
  already-fixed. (Local-only note: do NOT auto-close on GitHub
  without explicit "publish" go from Cam.)

### FFH `CONSOLIDATION-PLAN.md` at repo root
- **Status:** parked for deletion — orphaned, unrelated to this repo
- **Unblock:** Cam's "delete that file" confirmation.

---

## 🅿️ Parked

Items claimed in prior reports that are NOT on `main` and where the
prior claim couldn't be verified against the actual git history.
Listed here so future agents don't re-discover them and either
(a) re-implement or (b) silently delete them.

### Billing polish (per-site invoicing + Stripe portal)
- No `Billing`, `Invoice`, `Subscription`, or `Plan` model in
  `prisma/schema.prisma`. No Stripe dep in `package.json`. **Not
  shipped.** Listed under `ready` (form webhooks section above) —
  reclassify if anyone wants to claim ownership.

### Media library UI (S3-backed, reusable across sites)
- No `s3`, `media`, `library`, or `bucket` references in `src/`.
  `Attachment` model exists (F7) but is per-comment only. **Not
  shipped as a standalone library.**

### Template gallery (clone-template → new site)
- No `template` model in `prisma/schema.prisma`. Project creation
  flow has no template-from-source path. **Not shipped.**

### Team seats + role permissions
- `model TeamMember` exists with a `role` field but no enforcement
  layer in route handlers. Subsystem partial — UI for managing seats
  and middleware for role checks not wired.

### GitHub export (push generated site to user's repo)
- No `octokit`, `@octokit/`, or `github` dep in `package.json`. No
  GitHub-API code in `src/lib/`. **Not shipped.**

### Generation quality passes (LLM prompt + critic loop)
- No LLM client wrapper. Tied to the "Ship the AI-agent integration"
  item above.

### Analytics integration (Plausible / Fathom)
- No analytics script tag in `src/app/layout.tsx`. No env var for
  `PLAUSIBLE_DOMAIN` or `FATHOM_SITE_ID` in `.env.example`.
  **Not shipped.**

---

## How to add a new item

Append under the right column with a one-line description, a status
sub-bullet, and a source. If the item is `blocked`, name the
unblock. If `parked`, explain why a prior claim couldn't be
verified.

Don't delete items from `shipped` — even if the feature is later
deprecated, the historical record matters for "what was true when"
debugging.
