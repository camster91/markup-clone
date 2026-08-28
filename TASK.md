# TASK.md — markup-clone execution board

**Last updated:** 2026-08-28
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
  production; all 29 migrations, the off-host-verified backup, trusted public
  release verification, retained rollback image, and cron/CI state passed.
- **Runtime readiness:** Mailgun is configured. The previously missing delivery
  worker and integration-encryption secrets are now staged in the private VPS
  `.env`, validated against the exact image without printing values, and await
  the next deployment. The stale `mg.ashbi.ca` value is corrected to the active
  Mailgun domain `ashbi.ca`; `.env.example` keeps Docker `--env-file` values
  unquoted so quote characters cannot invalidate runtime configuration.
- **Current action:** pull request #43 passed its exact-head CI and security
  gates and merged as `a03b87d8d05db0a69b050c75d05baf383d611fea`.
  A fresh private/off-host backup and the release preflight passed; exact owner
  approval is now required immediately before deploying it. After deployment,
  Cameron must provision the still-absent `cameron@ashbi.ca` account from a
  user-owned trusted terminal and enter the password locally.
- **Next:** sign in and run owner/client desktop/mobile QA, verify
  integrations/operations, and remove every disposable record and file.
- **Execution record:**
  `docs/qa/production-launch-checklist-2026-08-28.md`.

---

## Ready

### Operational hygiene — reconcile the superseded PDF table

- **Status:** merged to `main`; exact owner approval and production deployment
  pending
- **Source:** `docs/plans/superseded-review-document-cleanup-2026-08-28.md`
- **Context:** production has 29 finished migration history rows while the
  deployed release contains 28 directories. The extra historical migration
  created an empty `ReviewDocument` table on `codex/public-onboarding`; current
  code uses the empty `ReviewAsset` table instead. Current `main` now contains
  the 29th source migration as the guarded cleanup.
- **Implementation:** `20260828180000_drop_superseded_review_document` no-ops
  when the old table is absent, refuses to drop it when any row exists, omits
  `CASCADE`, and removes it only when empty.
- **Verification:** the unit contract passes; a disposable PostgreSQL 16 rehearsal
  passed absent-table, empty-table, and nonempty-refusal paths while preserving
  the unexpected row.
- **Review evidence:** pull request #43 passed Ashbi Local CI and GitGuardian
  against exact head `9dae91753f67834ccd882f410c23240e1a787b07`, then
  merged without bypass as `a03b87d8d05db0a69b050c75d05baf383d611fea`.
- **Next:** after exact owner approval, deploy through the normal
  backup/rollback/preflight sequence, rechecking that the production table is
  still empty immediately before migration.

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
- Production has 29 finished migrations, trusted public-release verification,
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
