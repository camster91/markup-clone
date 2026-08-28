# Plans — index

This directory is the repository's planning source of truth. `TASK.md` is the
execution board; this index explains which documents govern current work and
which are retained as implementation evidence.

## Reading order

1. `launch-and-saas-replacement-roadmap-2026-08-28.md`
2. `TASK.md`
3. The plan linked by the highest-priority unblocked task
4. `agency-product-release-2026-08-07.md` for release-gate detail
5. Relevant current security or historical audit only when the task touches
   that surface

## Governing roadmap

- `launch-and-saas-replacement-roadmap-2026-08-28.md` — **Active and
  authoritative.** Orders plan reconciliation, authenticated production proof,
  PDF review, an Ashbi client pilot, paid-SaaS replacement, and evidence-led
  business improvements.
- `agency-product-release-2026-08-07.md` — **Release-gate specification.** The
  release candidate was deployed and rollback-tested; authenticated launch
  adoption continues under the governing roadmap.

## Active implementation

- `pdf-review-2026-08-10.md` — **Active.** The exact Linux runner-image
  renderer gate passed; bounded PDF upload and normal Page/Screenshot storage
  are the next implementation slice.

## Launch evidence with an open gate

- `release-candidate-operational-validation-2026-08-08.md` — Production was
  deployed and rollback-verified. The remaining launch gate is first-operator
  provisioning followed by authenticated owner/client production QA.

## Completed implementation evidence

These plans describe work already implemented on `main`. Their individual
production notes remain authoritative; do not infer live deployment merely from
local completion.

- `comment-lifecycle-2026-08-09.md`
- `image-review-uploads-2026-08-09.md`
- `review-rounds-workflow-2026-08-07.md`
- `developer-context-packet-2026-08-07.md`
- `structured-developer-handoff-2026-08-07.md`
- `internal-issue-metadata-2026-08-07.md`
- `reliable-integration-delivery-2026-08-08.md`
- `native-github-issue-delivery-2026-08-08.md`
- `invitation-claiming-and-agency-roles-2026-08-08.md`
- `workspace-branding-and-client-review-mode-2026-08-08.md`
- `client-site-organization-and-archive-2026-08-08.md`
- `managed-public-review-links-2026-08-08.md`
- `public-developer-api-and-browser-sdk-2026-08-08.md`
- `collaboration-transport-consolidation-2026-08-08.md`
- `project-summary-aggregation-2026-08-08.md`
- `role-aware-notifications-2026-08-08.md`
- `local-pin-ingestion-load-rehearsal-2026-08-08.md`
- `cross-browser-widget-and-accessibility-qa-2026-08-08.md`

## Product reference

- `markup-parity-and-agency-advantage-2026-08-07.md` — Competitor benchmark,
  product shape, and completed differentiation sequence. It is reference input,
  not an independent execution queue. Revalidate time-sensitive competitor
  claims before using them for a new requirement.

## Historical and security references

- `docs/qa/2026-07-24-production-security-audit.md` — current security and
  reliability audit for auth, integrations, and screenshot-serving work.
- `docs/refactor/2026-06-15-refactor-plan.md` and
  `docs/refactor/2026-06-17-p1-audit.md` — historical structural plans; verify
  every old gap against current code before acting.
- `docs/qa/production-grade-assessment.md` — historical readiness assessment;
  later audit and release evidence supersede many gaps.
- `docs/rate-limit-limitations.md` — current warning for horizontal scaling.
- `archive/` — superseded plans quarantined from execution. Read
  `archive/README.md` before opening anything there.

## Parked themes

These are not launch work unless pilot evidence creates a business case and a
new dated plan is added:

- AI-generated fixes and repository write access
- billing/subscription administration
- video review
- generic nested folders
- enterprise SSO/SCIM/compliance claims
- analytics integrations
- npm publication

## Maintenance rules

- New material work needs a dated plan and an entry here.
- Update `TASK.md` when work changes state.
- Keep completed plans as evidence; do not reclassify them as active because
  production QA is pending.
- Do not execute root `CONSOLIDATION-PLAN.md`; it is an unrelated FFH WordPress
  artifact.
- Do not start work from `archive/`.
