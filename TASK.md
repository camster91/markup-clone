# TASK.md — markup-clone execution board

**Last updated:** 2026-08-28
**Governing roadmap:**
`docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md`

Statuses are `in-progress`, `ready`, `blocked`, `shipped`, or `parked`.
Pick the highest unblocked item. A production dependency remains blocked until
its stated evidence exists; local tests do not silently close it.

---

## In progress

### L2.2 — Implement first-class PDF upload and review

- **Status:** in-progress
- **Source:** `docs/plans/pdf-review-2026-08-10.md`
- **Work:** bounded admin upload, opaque source/page storage, normal
  Page/Screenshot rows, owner/client UI, migration and cleanup evidence.
- **Gate now open:** L2.1 passed in the exact Linux runner image.

---

## Ready

### L5 — Record pilot-driven business improvements

- **Status:** ready after the first pilot begins
- **Source:** governing roadmap L5
- **Work:** capture deadlines/reminders, developer-handoff closure, reporting,
  workload, retention, and usage needs as observed problems. Add a dated feature
  plan before implementation.

---

## Blocked

### L1 — Provision the first production operator and run authenticated QA

- **Status:** blocked
- **Source:** governing roadmap L1 and
  `release-candidate-operational-validation-2026-08-08.md`
- **Blocker:** Cameron must supply the exact operator email and password through
  the approved secret-handling path. The repository and chat must never contain
  the plaintext password.
- **After unblock:** provision idempotently, run owner/client desktop/mobile QA
  against an exact deployed SHA, verify integrations/operations, and remove all
  disposable records and files.

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
