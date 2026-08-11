# Plans — index

This directory is the **landing zone for project plans**. Anything that
informs "what to build next" lives here, in version control, so any
agent that clones the repo lands on the current truth rather than
guessing from chat history.

## Layout

| Path | Purpose | Status |
|---|---|---|
| `archive/` | Superseded dev plans. Quarantined so they can't poison the next agent. **Read the warning in `archive/README.md` before opening anything here.** | active |
| `<name>-<YYYY-MM-DD>.md` | Active plans, dated. Newest first. | active |

## Current plans

- `docs/plans/pdf-review-2026-08-10.md` - **Active discovery and implementation
  plan.** Extend the shared review model to PDF pages only after a bounded
  renderer contract is proven in the production image.
- `docs/plans/comment-lifecycle-2026-08-09.md` - **Complete locally; queued
  for this core-SaaS release.** Project administrators can edit or delete a
  scoped comment while client and share-link reviewers remain read-only.
- `docs/plans/image-review-uploads-2026-08-09.md` - **Deployed; local browser
  QA complete.** First-class PNG, JPEG, GIF, and WebP project review surfaces
  without a parallel comment or sharing model. Production authenticated QA is
  pending the first operator account.

- `docs/plans/cross-browser-widget-and-accessibility-qa-2026-08-08.md` - **Complete
  locally; production untouched.** Real built-widget PNG capture, recapture,
  keyboard, focus, overflow, and visual QA across Chromium, Firefox, and WebKit.
- `docs/plans/local-pin-ingestion-load-rehearsal-2026-08-08.md` - **Complete
  locally; production untouched.** Reproducible multipart pin-ingestion capacity
  evidence with loopback enforcement, thresholds, and verified cleanup.
- `docs/plans/role-aware-notifications-2026-08-08.md` - **Complete locally;
  production untouched.** Self-service project-member email
  preferences and role-aware presets for feedback, replies, workflow, assignment,
  and mention events while preserving external pin alerts.
- `docs/plans/project-summary-aggregation-2026-08-08.md` - **Complete locally;
  production untouched.** Replaced overview relation-tree hydration with one
  authorization-scoped aggregate while preserving the compact role-safe DTO.
- `docs/plans/collaboration-transport-consolidation-2026-08-08.md` - **Complete
  locally; production untouched.** One truthful presence heartbeat
  and one SSE stream per focused project, with no false list-page presence.
- `docs/plans/managed-public-review-links-2026-08-08.md` - **Complete locally;
  production untouched.** Expiring/password-protected review
  links, token-bound HttpOnly media access, secret redaction, and client-safe
  unlock UX.
- `docs/plans/release-candidate-operational-validation-2026-08-08.md` - **Deployed
  and rollback-verified; first operator pending.** Reusable agency defaults,
  guarded backup/restore, ACME TLS repair, exact-SHA deployment, cross-browser
  production QA, and controlled rollback/forward-recovery evidence.
- `docs/plans/public-developer-api-and-browser-sdk-2026-08-08.md` - **Complete
  locally; production and npm untouched.** Hash-only scoped developer tokens,
  versioned read-only issue API, OpenAPI documentation, and a typed browser SDK
  lifecycle, with clean/upgrade migration and browser verification.
- `docs/plans/client-site-organization-and-archive-2026-08-08.md` - **Complete
  locally; production untouched.** Agency/client/site/review-round information
  architecture and reversible site archiving with active-by-default lists.
- `docs/plans/workspace-branding-and-client-review-mode-2026-08-08.md` - **Complete
  locally; production untouched.** Validated agency identity, operator-owned branding,
  and a simpler role-redacted client/guest project experience.
- `docs/plans/invitation-claiming-and-agency-roles-2026-08-08.md` - **Complete
  locally; production untouched.** Expiring hash-only invitations, invite-only account
  creation, canonical agency/client roles, project-scoped guests, and role-safe
  team/project UI.
- `docs/plans/native-github-issue-delivery-2026-08-08.md` - **Completed
  locally.** Encrypted repository credentials, safe repository
  verification, deterministic issue handoff, retry deduplication, and retained
  GitHub issue links; production remains approval-gated.
- `docs/plans/reliable-integration-delivery-2026-08-08.md` - **Completed
  locally.** Versioned events, transactional outbox delivery, webhook signing,
  bounded retries, immutable attempts, and an owner-visible delivery log;
  production remains approval-gated.
- `docs/plans/developer-context-packet-2026-08-07.md` - **Completed locally.**
  Privacy-bounded widget context, server validation, role-safe DTOs, and
  administrator-only developer context UI; production remains approval-gated.
- `docs/plans/structured-developer-handoff-2026-08-07.md` - **Completed
  locally.** Versioned issue payload, safe Markdown adapter, administrator copy
  action, and exact-pin dashboard deep links; external delivery remains pending.
- `docs/plans/internal-issue-metadata-2026-08-07.md` - **Completed locally.**
  Owner-only priority, claimed-team assignee, reusable project tags, combined
  filters, and role-safe developer-handoff enrichment; production remains
  approval-gated.

- `docs/plans/review-rounds-workflow-2026-08-07.md` — **Active implementation
  plan.** Durable review rounds, status, attributable sign-off, and paused-new-pin
  behavior with role and migration boundaries.
- `docs/plans/markup-parity-and-agency-advantage-2026-08-07.md` — **Active
  product definition.** First-party-verified competitor matrix and the ordered
  agency/developer differentiation slices.
- `docs/plans/agency-product-release-2026-08-07.md` — **Active release
  plan.** Security/reliability gates first, then core workflow parity,
  agency/developer differentiation, and production-readiness evidence.
- `docs/qa/2026-07-24-production-security-audit.md` — **Current**
  production security / reliability audit. Critical + High items
  patched on `cursor/production-security-audit-4eb8`. Read before
  any auth, integrations, or screenshot-serving change.
- `docs/refactor/2026-06-15-refactor-plan.md` — R0.x structural work,
  P0/P1/P2 prioritized. Most P0 items merged; P1 partially merged in
  the 2026-06-16/17 P1-wave audit cycle. See the R0 audit comment in
  `README.md` for what landed. R1.2 (CSRF) landed in the 2026-07-24
  security audit.
- `docs/refactor/2026-06-17-p1-audit.md` — Verification of the 4 fix
  cards from 2026-06-16 plus a P1-wave regression sweep. Read for
  context before touching the validators in `src/lib/validation.ts`.
- `docs/qa/production-grade-assessment.md` — Earlier (2026-06-12)
  production-readiness assessment. Superseded for auth/SSRF/CSRF by
  the 2026-07-24 audit; still useful for historical gap notes.
- `docs/rate-limit-limitations.md` — In-process rate-limit caveats.
  Read before scaling horizontally.

## Pending planning

The active agency product release plan now governs post-July work.
Feature-specific design documents should still be added before a
release gate expands into implementation work that is not specified
there.

## Don't

- Don't open the root `CONSOLIDATION-PLAN.md` — it's an orphaned FFH
  WordPress consolidation plan, unrelated to this repo. It is scheduled
  for deletion; do not act on it.
- Don't trust any plan dated before 2026-06-15 without re-validating
  against `git log --oneline` — much of the F1–F9 / P2.2 work has
  changed what was assumed.
