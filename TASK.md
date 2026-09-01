# TASK.md — markup-clone execution board

**Last updated:** 2026-09-01
**Governing roadmap:**
`docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md`

Statuses are `in-progress`, `ready`, `blocked`, `shipped`, or `parked`.
Pick the highest unblocked item. A production dependency remains blocked until
its stated evidence exists; local tests do not silently close it.

---

## In progress

### L1 — Provision the first production operator and run authenticated QA

- **Status:** in-progress
- **Source:** governing roadmap L1 and
  `release-candidate-operational-validation-2026-08-08.md`
- **Release evidence:** pull request #41 merged as
  `e4f8e4eb45017930969e9ba9f46e6100472f9a08`; that exact image is healthy in
  production. The approved PinThread-CSRF follow-up `main` release
  `26d906b512b43d25bea79846139aca9972d0abfc` was deployed on 2026-08-29;
  the deduplication follow-up then merged through pull request #50 and was
  deployed as exact SHA `e3f9c4d12986da641b01f758316c84e43013b3d8` on
  2026-08-29. All 30 finished migrations, the off-host-verified backup, trusted
  public release verification, retained `26d906b...` rollback image,
  worker/cron, and clean-log checks passed.
- **Current release:** Cameron approved consolidated exact SHA
  `81836384c0245fb3e445847a36bda2c377acf71b`, which deployed successfully on
  2026-09-01 as image
  `sha256:3914eb31be8145f4e00bafd45b612f603d193f838feed5f5716a77a5e924b465`.
  Fresh backup `markup-20260901T124257Z.dump` passed its remote restore catalog
  and checksum checks; its mode-0600 off-host copy independently verified
  SHA-256 `6b4aca9cf6435abcde1670976af5f754216bc7dadbb8fbd83a13667fa3bbf384`.
  The stopped, network-disabled retainer and protected rollback pointer both
  preserve exact prior image `e3f9c4d...` at
  `sha256:8718bfa28b62f949515e27dad48a093ac071e06a4c4dbdeb9a44602ca2790dda`.
  Trusted public verification, 30 clean migrations, the empty delivery queue,
  cron/CI, and clean post-deploy logs pass.
- **Runtime readiness:** Mailgun is configured. The previously missing delivery
  worker and integration-encryption secrets are active in the exact deployed
  container and passed shape checks plus a protected zero-work worker request
  without printing values. The stale `mg.ashbi.ca` value is corrected to the
  active Mailgun domain `ashbi.ca`; `.env.example` keeps Docker `--env-file`
  values unquoted so quote characters cannot invalidate runtime configuration.
- **Authenticated checkpoint:** `cameron@ashbi.ca` now exists as an operator and
  successfully received a production HTTPS session. A generated credential that
  appeared in terminal output during the first automated handoff was treated as
  compromised, immediately rotated, and replaced in macOS Keychain; it is no
  longer valid.
- **Authenticated progress:** the formerly blocked workspace write now succeeds
  in production. The operator created a timestamped workspace, client account,
  site, review round, uploaded image, feedback pin, and internal metadata on the
  exact deployed release.
- **Authenticated progress:** the formerly blocked reply now persists in
  production. The database advanced from one to two distinct comments and a
  reload renders the single new reply once.
- **Released fix:** pull request #50 makes the parent append idempotent by
  comment ID and includes a regression test that reproduces the SSE/POST race.
  The full release suite and focused 11-test regression pass, and the fix is
  running in production on exact SHA `e3f9c4d...`.
- **Authenticated verification:** after signing in through the trusted browser,
  one uniquely labelled reply rendered exactly once before reload, advanced the
  database from two to three distinct comment IDs with exactly one matching row,
  and rendered exactly once after reload. This closes the live SSE/POST
  deduplication gate on the exact deployed release.
- **Previous blocker:** broader owner QA passed at 1280x800 without horizontal
  overflow or console errors. At 375x812 it still had no overflow or console
  errors, but 18 visible form controls computed below 16px and 24 visible
  interactive targets measured below 44px on deployed SHA `e3f9c4d...`.
  Production mutation stopped at this first new launch-blocking failure on the
  prior release.
- **Verified mobile code:** pull request #54 merged without bypass as exact SHA
  `fa73b968fde3649c7f72c0ffaccd2397e383cff1`. Ashbi Local CI and GitGuardian
  passed; the focused mobile regression passes Chromium, Firefox, and WebKit,
  and the full local unit/lint/type/build gate passes.
- **Resolved release-safety finding:** read-only preflight found the documented
  `26d906b...` rollback image missing. The host's nightly
  `docker image prune -af --filter "until=24h"` removes tagged images that no
  container references. The healthy current `e3f9c4d...` image remains exact
  and available. The approved release captured it before replacement and the
  post-deploy retainer/pointer checks now pass.
- **Verified release-safety code:** pull request #56 merged without bypass as
  `35a105073148ed3107b6fb2f8c04ebb3084c1d3d`. Ashbi Local CI and GitGuardian
  passed. The helper fails closed unless the current image is immutable and
  exact, preserves it with a stopped isolated retainer, and refuses both
  unowned stable-name and temporary-name collisions.
- **Next:** the public sign-in surface passes a read-only 375x812 overflow check
  on exact deployed SHA `81836384...`, but the selected in-app browser is not
  signed in. Sign in through that protected browser, repeat the failed
  authenticated 375px control/target contract first, then continue broader
  owner/client QA and verified disposable-data cleanup. Obtain action-time
  approval before any new production QA write, external notification, or
  integration delivery.
- **Execution record:**
  `docs/qa/production-launch-checklist-2026-08-28.md`.

---

## Ready

### L5 — Record pilot-driven business improvements

- **Status:** ready after the first pilot begins
- **Source:** governing roadmap L5
- **Research baseline:** the dated market/operating-model reference now records
  the product charter, current first-party competitor and pricing evidence,
  focused agency position, preliminary commercial hypothesis, access/approval
  boundaries, risk and decision registers, and measurable pilot contract.
- **Boundary:** these are researched hypotheses, not customer validation,
  approved pricing, or a reason to displace L1-L4.
- **Work:** capture deadlines/reminders, developer-handoff closure, reporting,
  workload, retention, and usage needs as observed problems. Add a dated feature
  plan before implementation.

---

## Blocked

### L3 — Run the first Ashbi client pilot

- **Status:** blocked on L1 and Cameron's project selection
- **Source:** governing roadmap L3
- **Blocker:** choose one low-risk real client site, a cooperative reviewer, and
  a reversible review window.
- **Evidence readiness:** `docs/qa/client-pilot-record-template.md` is ready to
  capture approval, exact release identity, incumbent baseline, observed
  journey, metric results, failures/recovery, cleanup, and the explicit
  second-project/30-day decision without inventing customer validation.

### L4 — Replace and cancel the paid SaaS

- **Status:** blocked on successful L3 plus a second-project or 30-day proof
- **Source:** governing roadmap L4
- **Boundary:** export required data and obtain Cameron's explicit cancellation
  approval before changing the subscription.

---

## Shipped (don't re-implement)

The detailed completed-plan list is in `docs/plans/README.md`. The historical
capabilities below remain here because this board is the source of truth for what
landed on `main`.

### L0 (plan reconciliation)

- One authoritative launch/SaaS-replacement roadmap
- Top-level plans classified as governing, active, completed evidence,
  product/historical reference, or parked
- Stale and contradictory task-board priorities removed

### Operational hygiene — superseded PDF table

- The guarded `20260828180000_drop_superseded_review_document` migration
  rechecked that production had zero legacy rows, then completed atomically in
  release `da6bae53949edd62f4996a161189e3bd38bbf8b5`.
- Production now has 30 finished, non-rolled-back migrations and
  `ReviewDocument` is absent. Current PDF review continues through
  `ReviewAsset`.

### L2.1 (bounded PDF renderer)

- Exact Linux/arm64 production runner image built successfully
- Build-time renderer probe ran with BuildKit networking disabled
- Loaded image repeated the probe under `--network none`
- Poppler 25.12.0 rendered one aspect-preserving 1484x1920 PNG within
  timeout/page/pixel bounds and removed its temporary directory

### L2.2-L2.3 (first-class PDF review, local evidence)

- Authenticated project-admin PDF upload with CSRF, per-project/origin rate
  limiting, MIME and magic-byte checks, a 20 MB source limit, a 50-page limit,
  bounded Poppler execution, a 1920px page limit, and 250 MB total output limit
- Opaque source/PDF and rendered-page storage with a private ReviewAsset record;
  original filename and PDF text never enter the database, DTO, or audit event
- Rendered pages reuse Page/Screenshot, pins, annotations, comments, rounds,
  notifications, sharing, and sign-off; dashboard reviewers can click any
  uploaded or rendered image to create a normal feedback pin
- Exact Linux image and all 28 checked-in migration directories passed in
  disposable Compose
- Owner review at 1280px/375px, two-page upload, click-to-pin, managed-share
  review at 375px, no overflow/request/console errors, and product deletion of
  the database rows, source PDF, rendered PNGs, and work directory all passed
- **Remaining L2 evidence:** repeat the PDF journey against the deployed SHA
  during L1 production QA

### F1–F3 (recapture + screenshots)

- Annotation tool selector (arrow/box/freehand)
- `validateScreenshotId` on recapture + status routes
- Screenshot polling abort on unmount
- Rate-limit on `/api/screenshots/[id]/status`
- Lightweight status polling instead of the full project tree

### F4–F5 (events + SSE)

- SSE endpoint at `/api/events`
- In-memory pub-sub for live pin/comment/recapture updates
- Dashboard hook consumes the SSE stream

### F6 (audit / dashboard polish)

- Audit log surfaced at `/api/audit`
- Relative update times
- Unified origin parser

### F7 (comments)

- Image attachments
- `@mentions` and notification delivery
- Exact comment/thread navigation
- Comment create rate-limit
- Administrator comment edit/delete lifecycle on `main`

### F8 (integrations outbound)

- Slack, Discord, generic webhook, and native GitHub issue delivery
- Per-project configuration with encrypted GitHub credentials
- Versioned events, validation, bounded retries, delivery log, and manual retry

### F9 (multi-tenant agency model)

- Workspace → Team/client → Project/site → Review round hierarchy
- Enforced operator/owner/contributor/client/guest authorization boundaries
- Invitations, branding, reviewer mode, archives, notification preferences,
  managed sharing, and reversible project organization

### P2.2 (shared packages and widget)

- `@markup/core` shared primitives
- Vite widget build and split ES modules
- Typed `@ashbi/markup-sdk` package built locally (npm remains unpublished)

### Review workflow and assets

- Website widget feedback, screenshots, annotations, threads, resolution,
  recapture/history, presence, and sign-off
- First-class PNG/JPEG/GIF/WebP upload on `main`
- Public developer API v1 and structured developer handoff
- Local ingestion rehearsal and Chromium/Firefox/WebKit E2E coverage

### Production security audit

- **Commits:** `0930aef`, `76d22ec`
- Session authentication, CSRF, scoped project/media access, role-safe DTOs,
  safe outbound URLs, secret redaction, attachment type restrictions, and
  server-derived presence identity

### Production release evidence

- Pull request #41 merged as `e4f8e4eb45017930969e9ba9f46e6100472f9a08`
  and that exact source-SHA image was deployed successfully on 2026-08-28.
- That release had 29 finished migrations, trusted public-release verification,
  a checksum-verified off-host backup, a retained immutable rollback image, and
  active cron and local-CI services for this release.

- Exact-SHA deployment, all 26 then-current migrations, trusted TLS,
  backup/restore drill, retained rollback image, controlled rollback/forward
  recovery, public/widget cross-browser QA, and health checks were completed for
  the 2026-08-08 release.
- This does not replace L1 authenticated QA for later `main` changes.

---

## Parked

These themes do not displace launch. Promote one only after pilot evidence and a
new dated plan.

- AI-generated fixes and repository branch/commit/PR writes
- Billing, subscriptions, and payment-provider setup
- Video/voice review
- Generic nested folders and bulk organization beyond the current hierarchy
- Enterprise SSO, SCIM, or compliance claims
- Standalone S3 media library
- Project templates
- Analytics integrations
- npm publication
- Per-site sitemap/OG work unrelated to the review workflow
- Form-submission webhooks unrelated to visual-feedback events
- Root `CONSOLIDATION-PLAN.md` deletion (unrelated FFH artifact; requires
  Cameron's explicit deletion approval)

---

## Board maintenance

- Update this file whenever a task changes state.
- Record the commit SHA when a slice ships.
- Keep completed entries; do not infer production deployment from a merge.
- Never move a parked idea into implementation without a dated plan.
