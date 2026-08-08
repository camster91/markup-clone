# Agency product release plan — 2026-08-07

**Status:** active
**Owner:** repository maintainers
**Objective:** ship the Visual Feedback Tool as a secure, production-ready
MarkUp.io alternative with a stronger workflow for web developers and agencies.

This plan is the post-July roadmap requested after the 2026-08-07 code, UI/UX,
accessibility, responsive, and backend review. It supersedes the empty
"Pending planning" slot in `docs/plans/README.md`; it does not supersede the
historical refactor or security audits.

## Product position

The core job is fast, contextual client feedback on a real website. Practical
parity means that a client can open a review, place visual feedback, discuss it,
and confirm resolution without learning a project-management tool.

The differentiated agency/developer layer will make that feedback immediately
actionable:

- capture technical context with each issue;
- turn feedback into a structured developer handoff;
- organize multiple clients, teams, sites, and review rounds safely;
- present a branded, professional client experience;
- integrate with existing delivery workflows without exposing client secrets.

Any detailed competitor-parity checklist must be verified against current,
first-party MarkUp.io material before it becomes a release requirement. The
verified 2026-08-07 matrix and ordered product slices now live in
`docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`.

## Release gates

### Gate 0 — security and correctness

No feature expansion ships before these are closed:

- Anonymous dashboard requests return no project, pin, comment, subscriber,
  attachment, API-key, share-token, or integration data.
- Every project read/write is authenticated and authorized at the data-access
  boundary. Client-side hiding is not an authorization control.
- Team roles are enforced: owner-only membership/role/destructive operations;
  reviewer access is non-administrative.
- Attachment claims are limited to unbound attachments owned by the same
  project.
- Screenshot/media access requires an authenticated project membership or a
  valid public-share capability.
- Share-link hydration is deterministic and produces no React recovery errors.
- Host/origin parsing has one documented representation and preserves ports.
- Production dependency audit has no unresolved critical/high advisory without
  an explicit, reviewed exception.

### Gate 1 — complete core review workflow

- Project list and detail views use bounded DTOs rather than full nested trees.
- Website/widget capture, contextual pins, threads, annotations, resolution,
  recapture/history, sharing, subscribers, integrations, and presence have
  automated coverage and browser QA.
- Loading, empty, offline, unauthorized, and retry states are bounded and
  actionable.
- Workspace and team navigation is complete; no rendered control targets a 404.
- Mobile layouts work at 320, 375, and 768 CSS pixels without clipping.
- WCAG 2.2 AA basics pass: names, labels, contrast, keyboard operation, focus,
  semantic headings, and practical touch targets.

### Gate 2 — developer and agency advantage

- Pin handoff includes URL/path, viewport, browser, selector, captured element
  context, screenshot/version, priority, status, and assignee-ready fields.
- Agencies can separate clients and teams, apply role-safe access, and preserve
  an audit trail across review rounds.
- Client-facing reviews support agency identity and a simplified reviewer mode
  that does not expose API keys or administrative controls.
- Integrations export a stable, structured issue payload suitable for GitHub
  and common project-management systems.
- Reusable project/review defaults reduce setup for recurring agency work.

### Gate 3 — production release

- `npm run lint`, the full Vitest suite, Prisma validation, and a production
  Next.js build pass from a clean checkout.
- Docker build succeeds from Windows and Linux checkouts.
- Desktop/mobile/keyboard browser QA passes the primary client and operator
  journeys with no console, hydration, failed-request, or accessibility errors.
- Backup/restore, rollback, observability, rate-limit, and incident runbooks are
  exercised against a non-production environment.
- Production deployment and public release remain separately approval-gated.

## Execution order

1. Fix anonymous rendering and centralize project-access DTOs.
2. Add role-aware authorization and attachment/media ownership enforcement.
3. Fix hydration, origin configuration, broken routes, and dependency/build
   gates.
4. Reduce list payloads and repair loading/offline states.
5. Complete responsive and accessibility remediation.
6. Verify current competitor parity from first-party sources and close genuine
   core-workflow gaps.
7. Build the agency/developer differentiators behind tested access boundaries.
8. Run the full production-readiness audit and stage a release candidate.

## Verification discipline

Each behavior change follows RED → GREEN → REFACTOR. A passing unit test proves
only its tested scope; release claims require the matching integration,
browser, build, deployment, and operational evidence listed above.

## Progress log

### 2026-08-07 — Gate 0 authorization foundation

- Closed anonymous server-rendered dashboard and direct project-page data
  exposure.
- Scoped project, workspace, and team reads to the authenticated caller while
  preserving global operator visibility.
- Restricted workspace/team administration and membership changes to the
  appropriate operator or team-owner role.
- Added regression coverage for page and API access boundaries.
- Replaced the shared-core Unix-only build wrapper with a cross-platform Node
  entrypoint.
- Verified: `npm run lint`; `npm test` (466 passed, 3 deployment-shell tests
  skipped because Bash is unavailable on this Windows host); `npm run build`.

Gate 0 remains active. Attachment/media ownership, share hydration, origin
configuration, and dependency review are the next release blockers.

### 2026-08-07 — protected media, runtime, and responsive foundation

- Scoped attachment uploads and claims to their owning project, including a
  backfill-safe database migration.
- Replaced forgeable dashboard-origin media access with authenticated project
  access or a valid public-share capability.
- Forwarded public-share capabilities through current screenshots, history,
  and comment attachments; shared comments now include attachment DTOs.
- Removed locale-dependent server/client timestamps that caused hydration
  recovery and added real server-render/hydrate regression coverage.
- Canonicalized dashboard origins, preserved configured ports, and removed the
  attempted client-written `Origin` header.
- Upgraded Next.js and the test/build toolchain; the full dependency audit now
  reports zero vulnerabilities.
- Fixed the 375px dashboard overflow and verified dashboard, workspace, and
  project screens at desktop and mobile widths in headless Chromium.
- Repaired the local Docker stack: matching development credentials, correct
  HTTP widget URL, and a one-shot migrator that applies all migrations before
  the application starts. Verified against a fresh named Docker volume.
- Verified: Prisma schema validation; ESLint; TypeScript; Docker Compose config;
  `npm test` (478 passed, 3 deployment-shell tests skipped on Windows); full
  dependency audit; Next.js production build; Docker production build; and
  authenticated desktop/mobile browser QA.

Gate 0 remains active. The next security slice is role-safe project creation,
settings, key rotation, sharing, and deletion. Gate 1 then starts with the
currently broken team-detail navigation, bounded project-list DTOs, and the
remaining accessibility/responsive audit.

### 2026-08-07 — role-safe administration and complete team navigation

- Restricted project creation, rename, API-key rotation, deletion, public
  sharing, subscriber settings, and integration settings to global operators
  or the owning team role at the server boundary.
- Redacted API keys, share tokens, and subscriber addresses from reviewer API
  and server-rendered payloads; reviewer pages no longer mount administrator
  controls or issue settings requests they cannot use.
- Added an explicit reviewer-mode badge and retained the collaboration surfaces
  needed for captures, pins, comments, and presence.
- Repaired the workspace team link with a role-scoped team detail page listing
  projects and members. Owners/operators can create a project directly inside
  that team; reviewers receive the read-only team view.
- Verified: ESLint; TypeScript; focused authorization, page, and component
  suites; full Vitest suite (495 passed, 3 deployment-shell tests skipped on
  Windows).

Gate 0 authorization work is complete for the audited project administration
surfaces. Gate 1 is active next: bounded project list/detail polling DTOs,
remaining loading/offline behavior, accessibility, and 320/768px browser QA.

### 2026-08-07 — bounded dashboard DTO and accessibility baseline

- Replaced the project-index full review tree with a compact summary DTO carrying
  project identity, role-safe setup fields, team metadata, and page/capture/pin
  counts only. Comments, annotations, screenshot context, and subscriber rows are
  no longer loaded or serialized for project cards.
- Replaced the unsafe parent-timestamp delta strategy with complete compact-list
  polling, so nested pin-count changes and project deletion cannot be missed.
- Added an authenticated single-project detail endpoint and shared serializer;
  first render and later detail refreshes now use the same full-detail contract.
- Added visible global keyboard focus, missing form labels and control names,
  expanded-state semantics, and live error announcements across the audited forms.
- Fixed a real 320px project-card title/count collision found by screenshot review.
- Verified: full Vitest suite (500 passed, 3 Windows shell checks skipped), ESLint,
  TypeScript, production Next.js build, Docker build/migration/startup, and live
  browser QA at 320, 375, and 768px. The tested pages had zero horizontal overflow,
  associated input labels, visible keyboard focus, and no blocking console/network
  failures. Disposable QA containers, database, and volumes were removed afterward.

Gate 1 remains active for loading/offline states, the deeper project-review keyboard
journey, and remaining accessibility polish. Build warnings for disk-backed media
tracing and the widget public/outDir overlap remain tracked release-cleanup items.

### 2026-08-07 — current MarkUp.io benchmark and product wedge

- Verified the competitor benchmark against current first-party pricing, FAQ,
  developer, SDK, API, webhook, and workflow material.
- Documented repository-backed strengths, partial parity, genuine missing
  capabilities, and explicit non-claims in
  `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md`.
- Chose the primary differentiation: a privacy-bounded developer context packet,
  reliable structured handoff, agency-branded reviewer mode, and review rounds.
- Ordered status/sign-off/comment pausing before broad file review so the core
  website workflow becomes coherent before product breadth expands.
- Replaced silent project-list and project-detail polling failures with an
  announced, actionable retry state while preserving the last successful data.
- Added regression coverage for server/network failure and recovery through the
  manual retry action.

### 2026-08-07 — Gate 1 keyboard, loading, and runtime closure

- Implemented standard roving keyboard behavior for screenshot Latest/History
  tabs, including arrow, Home, and End navigation with linked tab panels.
- Added focus entry, Escape close, focus trapping, and trigger-focus restoration
  to screenshot-history dialogs; pin threads now focus their close action and
  return focus to the originating marker.
- Added an actionable history retry state and an announced route-transition
  loading skeleton.
- Added main landmarks to every user-facing route and replaced stale clone-tool
  metadata with the actual visual-feedback product description.
- Found and repaired a live local-runtime defect: Compose now sets
  `HOSTNAME=0.0.0.0`, allowing Next.js to answer its loopback healthcheck.
- Live authenticated browser QA at 320px and 375px confirmed zero horizontal
  overflow, no controls outside the viewport, no unlabeled form fields, working
  focus return/trapping, and no console errors. Aborted requests were limited to
  Next.js speculative RSC prefetch cancellation during navigation.

### 2026-08-07 - review-round persistence and pause enforcement

- Added an explicit active review-round domain model, attributable sign-offs,
  closed workflow statuses, and nullable legacy pin association through an
  additive migration.
- New feedback is associated with the active round. When that round is paused,
  the pin boundary returns HTTP 409 with stable code `NEW_FEEDBACK_PAUSED` before
  writing page or attachment state; replies to existing threads are unaffected.
- Rebuilt the production Compose image and applied the migration to the existing
  disposable QA database. The app and database were healthy, and the existing
  one-project/one-pin dataset was preserved without creating a synthetic round.
- Verified: full Vitest suite (518 passed, 3 skipped), ESLint, TypeScript, Prisma
  validation/generation, and production Next.js build. Round/sign-off management
  APIs and the review workflow UI are the next active slice.

### 2026-08-07 - review-round management and client sign-off

- Added authenticated, project-scoped APIs for round listing/creation/status and
  pause changes plus attributable sign-off and withdrawal. Writes are CSRF-gated,
  audited, and role-enforced; historical rounds cannot be mutated or newly signed.
- Added a bounded owner/reviewer Review workflow surface with explicit loading,
  retry, empty, active, paused, approval, withdrawal, and history states.
- Added website-widget handling for the stable paused-feedback response. A client
  keeps their typed draft and sees that existing-thread replies remain available.
- Reinforced the additive migration with database checks for workflow status,
  positive numbering, and bounded round/sign-off text.
- Verified: full Vitest suite (533 passed, 3 skipped), ESLint, TypeScript, Prisma
  validation/generation, and production Next.js build. Existing widget outDir and
  disk-media tracing warnings remain tracked; browser QA is the next proof step.

### 2026-08-07 - review workflow browser closure

- Rebuilt and ran the production Docker image with the full additive migration
  chain; application and database healthchecks passed.
- Verified the owner journey at 375px: create a named round, transition to In
  review, pause new pins, and retain existing-thread reply guidance.
- Verified the reviewer journey at 320px: no credentials or management controls,
  visible paused state, attributable sign-off, and withdrawal. Both journeys had
  zero horizontal overflow, no controls outside the viewport, and no workflow
  console errors.
- Fixed the reviewer dashboard’s missing explicit entry point found during live
  QA by adding an “Open review” link outside the administrator-only metadata row.
- Final full regression: 533 tests passed and 3 skipped. The temporary local QA
  stack and all disposable data were removed. The next product slice is the
  privacy-bounded developer context packet and structured issue handoff.

### 2026-08-07 - privacy-bounded developer context

- Captured canonical page/route, viewport and DPR, bounded browser/platform,
  selector candidates, and a scrubbed element snippet with each new website pin.
  URL queries, fragments, credentials, form values, token-like attributes,
  console output, and network traffic are excluded.
- Added nullable persistence with application and database bounds. A disposable
  pre-migration rehearsal reapplied the migration over a legacy pin and verified
  that the row survived with empty context fields.
- Added a collapsed administrator-only developer context panel with screenshot
  and review-round metadata. Reviewer and public-share payload tests prove that
  technical selectors, HTML, browser, platform, and context are not serialized.
- Fixed the share-link server/client hydration mismatch discovered during visual
  QA while preserving an absolute copyable URL after hydration.
- Verified: 554 tests passed and 3 skipped; ESLint, TypeScript, Prisma validation,
  production and Docker builds, Docker health, and owner/reviewer browser QA at
  1280px and 375px passed with no console or hydration errors. The next slice is
  a versioned issue payload and copyable Markdown handoff.

### 2026-08-07 - versioned Markdown developer handoff

- Defined `visual-feedback.issue.v1` as the canonical bounded issue payload for
  project/page/pin identity, status/coordinates, conversation, screenshot,
  review-round, and privacy-bounded developer context.
- Added deterministic Markdown rendering with untrusted-prose escaping, dynamic
  code fences, ordinary-punctuation preservation, and explicit schema identity.
- Added an administrator-only clipboard action with success/failure feedback.
  Copied output excludes project keys, share/session tokens, raw attachment URLs,
  query strings, cross-domain URLs, and raw user-agent data.
- Added stable `?pin=` review links that open the exact feedback thread after a
  reload, ignore invalid ids, preserve unrelated URL state, and remain keyboard
  operable. Reviewer/public views receive no technical or handoff control.
- Verified: 565 tests passed and 3 skipped; ESLint, TypeScript, Prisma validation,
  production and Docker builds, Docker health, and authenticated owner/reviewer
  browser QA at 1280px and 375px passed with no console or hydration errors.
  Clipboard content and reviewer DOM redaction were asserted directly. The
  disposable QA database, media, containers, and network were removed.

### 2026-08-08 - internal agency issue management

- Added legacy-safe priority, claimed-team assignment, reusable project tags,
  and project-level AND filters without exposing internal agency workflow to
  reviewers or public-share viewers.
- Preserved reviewer open/resolved updates while requiring owner/operator access
  for all internal fields. Assignment rejects pending, cross-team, and unscoped
  users; tag replacement is normalized, bounded, and project-atomic.
- Added owner-native, keyboard-operable editing plus result counts, clear and
  empty states, and internal fields in the administrator-only versioned Markdown
  handoff.
- A disposable pre/post-migration rehearsal preserved a legacy pin as no
  priority, unassigned, and untagged; database constraints rejected invalid
  values. Production Docker build, migration, startup, and healthchecks passed.
- Verified 588 tests passed and 3 skipped; ESLint, TypeScript, Prisma validation,
  and authenticated owner/reviewer browser QA passed at 1280, 375, and 320
  pixels, with direct keyboard/clipboard/redaction assertions, zero overflow,
  zero console errors, and zero unexpected failed requests.
- The next ordered slice is a versioned integration-event envelope with signing,
  durable retries, and a delivery log before GitHub issue delivery is added.

### 2026-08-08 - native GitHub issue delivery

- Added explicit repository and label configuration with AES-256-GCM encrypted,
  repository-scoped credentials. Plaintext and ciphertext are excluded from
  browser, API, event, audit, attempt, and error boundaries.
- Added read-only repository verification plus deterministic issue creation from
  `visual-feedback.issue.v1`. A stable hidden event marker recovers the common
  accepted-response-lost retry case without creating a routine duplicate.
- Persisted only validated issue numbers and canonical `github.com` issue URLs;
  owners can open them from delivery activity while reviewers and public-share
  viewers receive no integration metadata.
- A fresh database applied all 19 migrations, the production container and
  protected worker passed runtime checks, and no local QA request contacted
  GitHub.
- Verified 667 tests passed and 3 skipped; ESLint, TypeScript, production and
  Docker builds, and authenticated owner/reviewer browser QA passed at 1280,
  375, and 320 pixels with keyboard assertions, zero overflow, zero console
  errors, and zero unexpected failed requests.
- Visual inspection found and fixed unreadable repository truncation at 320px.
  The next ordered slice is invitation claiming and explicit agency/client roles.

### 2026-08-08 - local release candidate and recovery proof

- Completed hash-only developer tokens, the versioned read-only issue API,
  OpenAPI guide, dependency-free typed browser SDK, and explicit widget lifecycle.
- Added owner-managed client-account review defaults with numbered suggestions,
  optional paused starts, client redaction, and an additive legacy-safe migration.
- Removed widget/public overlap and runtime-media tracing warnings from the
  production build using tested Vite and installed Next 16 configuration.
- Added private integrity-checked PostgreSQL backups and guarded restores. A
  disposable drill proved refusal against a non-empty target, then restored the
  original data and all 24 migration records after stopping writers. The drill
  caught and fixed PostgreSQL 18/16 tool skew by pinning client 16.14.
- Clean Linux image build, empty-database migration, health, rate-limit suites,
  and combined authenticated owner/client/API/SDK browser QA passed locally.
- Prior-image rollback remains open: the historical committed source cannot
  build because its old Unix wrapper is missing and no prior local image remains.
  Production, Git, npm, and the retained-image rollback require explicit approval.

### 2026-08-08 - managed public review links

- Replaced token-bearing shared-media URLs with an expiry-aware, optional-password
  opener that establishes a token-bound HttpOnly, SameSite=Strict cookie. Rotation,
  password replacement, expiry, and revocation invalidate prior access.
- Added constant-time checks, password-attempt throttling, `no-referrer` metadata,
  private/no-store shared-media caching with `Vary: Cookie`, and indistinguishable
  missing/expired link responses. Password hashes and tokens stay out of client DTOs.
- Added agency-branded, keyboard-usable unlock UI and responsive owner controls for
  creating, replacing, copying, and revoking links with clear protection/expiry state.
- At the managed-share checkpoint, clean migration installation, the then-current
  full suite, Prisma validation, ESLint, production build, dependency audit, and
  authenticated 1280/320/375px Chromium QA all passed. Later aggregate counts are
  recorded by the newer checkpoints below.
- Production, Git, npm, and the retained-prior-image rollback remain approval-gated.

### 2026-08-08 - collaboration transport consolidation

- Removed overview-card heartbeats that falsely marked the current user present in
  every visible site. Collaboration now starts only on a focused project.
- Consolidated any screenshot count to one session-bound presence heartbeat/list
  poll and one project SSE stream. Screenshot cursors publish through a shared ref,
  and event bursts coalesce while a detail refresh is in flight.
- Final-tree verification passed 848 tests with 3 skipped, warning-free ESLint,
  Prisma validation, zero-vulnerability dependency audit, and host/Linux production
  builds. Authenticated 375px Chromium measured 0 overview transports and exactly
  1 SSE stream plus 2 presence reads/heartbeats over a full two-screenshot cadence,
  with routed cursor coordinates, zero overflow, and zero browser errors.
- Production, Git, npm, and retained-prior-image rollback remain approval-gated.

### 2026-08-08 - project summary aggregation

- Replaced home and `/api/projects` relation-tree hydration with scalar scoped
  project reads plus one parameterized PostgreSQL aggregate over only the
  already-authorized project IDs. Card counts and role-redacted DTOs are unchanged.
- Projects without pages deterministically receive zero counts; no migration or
  denormalized counters were introduced. Live local Chromium rendered the seeded
  two-screenshot, three-pin project as `3 pins` and `2 open`.
- Final-tree verification passed 848 tests with 3 skipped, warning-free ESLint,
  Prisma validation, zero-vulnerability production dependency audit, and host/Linux
  production builds. The existing collaboration transport QA stayed green at 375px.
- Production, Git, npm, and retained-prior-image rollback remain approval-gated.

### 2026-08-08 - role-aware project notifications

- Added one self-owned project preference per registered member with explicit
  email choices for new feedback, replies, status changes, assignments, and
  mentions. Safe defaults preserve existing mentions without silently opting
  members into other mail; agency and client roles receive distinct recommendations.
- New-feedback, reply, reopen, status, assignment, and mention paths now honor
  preferences, exclude known actors, revalidate current project membership, and
  deduplicate targets. Removed members and wrong-project guests cannot receive
  project content from stale preference rows; overlapping external/member addresses
  receive only the legacy external alert for new feedback.
- Added workspace-branded, escaped member mail and a keyboard/mobile self-service
  panel visible to every authenticated project role. External email addresses remain
  an explicitly labeled owner-only new-feedback alert list.
- Upgrade and clean-install drills passed all 26 migrations. Final-tree verification
  passed 848 tests with 3 skipped, warning-free ESLint, Prisma validation, a
  zero-vulnerability production audit, and host/Linux production builds. Operator
  and client Chromium QA passed at 1280/375px with zero errors and no Mailgun calls.
- Production, Git, npm, and retained-prior-image rollback remain approval-gated.

### 2026-08-08 - local pin-ingestion load rehearsal

- Added a dependency-free, loopback-only production-mode rehearsal of the real
  authenticated multipart `POST /api/pins` path with bounded concurrency,
  percentile/throughput summaries, explicit p95/status thresholds, and a
  disposable fixture lifecycle.
- The fixture command refuses any non-Compose database/dashboard combination.
  Cleanup is guaranteed through the runner's `finally` path and independently
  verifies zero fixture project rows, screenshot rows, and captured files.
- A 24-request run at concurrency 6 returned 24 HTTP 201 responses in 419ms:
  57.28 requests/second, p50 91ms, p95 157ms, and p99 179ms. The full suite now
  passes 875 tests with 3 skipped, and standalone ESLint is warning-free.
- This closes the unmeasured local ingestion gap; it does not prove production
  capacity. Production, Git, npm, and retained-prior-image rollback remain
  approval-gated.

### 2026-08-08 - cross-browser widget and accessibility proof

- Repaired the E2E fixture so it executes the current built widget, then fixed a
  real screenshot defect it exposed: blob-backed SVG `foreignObject` rendering
  tainted Chromium's canvas and prevented `toBlob()`. The origin-clean data-URL
  path now sends an actual PNG without adding a rendering dependency.
- The mobile widget now has a labeled modal and fields, 16px inputs, 44px controls,
  visible/trapped focus, Escape close, deterministic focus return, pressed-state
  annotation tools, viewport-safe sizing, and consistent engine typography.
- All 9 production-mode E2E journeys passed on Chromium 151, Firefox 153, and
  WebKit 26.5. Three 320px captures were visually inspected with no clipping,
  overflow, hierarchy, focus, spacing, or typography defect remaining.
- The current final tree passes 875 Vitest tests with 3 skipped, warning-free
  ESLint, Prisma validation, a zero-vulnerability production audit, host and
  exact Linux production builds, and container health/hash verification.
- Production, Git, npm, and retained-prior-image rollback remain approval-gated.

### 2026-08-08 - immutable rollback-image preflight

- Read-only production inventory confirmed that the healthy live container uses
  an immutable source-SHA image tag, that its exact image ID remains retained on
  the host, and that the public health endpoint returns HTTP 200.
- Added a fail-closed pre-migration deploy preflight that rejects mutable,
  malformed, missing, or retargeted images and atomically records the verified
  rollback tag and image ID with private permissions. Dirty tracked or untracked
  source now also stops before it can be mislabeled with a commit SHA.
- Six executable contract tests cover success, mutable tags, missing images,
  tag/image mismatch, deploy ordering, and dirty-source refusal. Actual rollback
  execution, deployment, Git, and npm publication remain explicitly approval-gated.
- Final-tree verification passed 881 tests with 3 intentional skips,
  warning-free ESLint, Bash syntax checks, host and Linux production builds, and
  a second matching read-only production image/health check.

### 2026-08-08 - release-tree and deploy-integrity audit

- Audited all changed and untracked release files, all 48 API route files, all 26
  ordered migrations, documentation-plan indexing, QA artifacts, line endings,
  and credential patterns. Playwright reports are now excluded from Git and the
  Docker context, and shell scripts have an explicit LF policy.
- Replaced a migration path that could suppress SQL errors and still write a
  Prisma history marker. The helper now uses a fail-fast transaction containing
  both the migration SQL and history marker; contract tests and a disposable
  real-DB failure/success rehearsal prove both sides. A fresh-database deploy
  rehearsal also bootstrapped Prisma history and applied all 26 migrations with
  26 finished records before removing the probe database.
- Removed tarball and legacy marker release provenance. Deployment now requires an
  authenticated Git fast-forward, a valid source commit, and a clean tracked and
  untracked tree before assigning the immutable image tag.
- Read-only production verification confirmed remote Git authentication, the
  retained rollback image, and health. It also found byte-identical, mode-only
  drift on `scripts/prune-screenshots.sh` (`0755` host, `0644` Git), which the new
  guard correctly treats as a release stop. Reconciliation, rollback execution,
  commit, push, npm publication, and deployment remain approval-gated.
- Current final-tree gates pass 896 tests with 3 intentional skips, warning-free
  ESLint, Prisma validation, a zero-vulnerability production dependency audit,
  host and exact Linux production builds, and an isolated healthy image/hash run.
- Verified that Traefik—not Caddy—owns the live public edge. Added fail-closed
  route/trusted-TLS checks around migrations and startup, isolated all legacy
  Caddy behavior behind explicit detection, and stopped cron from changing tracked
  modes. The live preflight now correctly blocks on the existing self-signed
  Markup certificate; certificate issuance/reload and all other production writes
  remain approval-gated.
- A verified archived Let's Encrypt certificate/key pair provides a trusted,
  matching rollback through 2026-09-13. The approved repair sequence will restore
  it atomically before transitioning the enabled `markup@file` router to its
  configured ACME resolver, with the archive retained if issuance fails.
