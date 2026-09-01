# Launch and paid-SaaS replacement roadmap — 2026-08-28

**Status:** active and authoritative
**Owner:** Cameron Ashley
**Execution board:** `TASK.md`
**Market and operating model:**
`docs/plans/market-position-and-operating-model-2026-08-28.md`

## Goal

Launch Ashbi Visual Feedback as the reliable system Ashbi uses for visual review,
retire the paid visual-feedback SaaS after evidence from real client work, and
then invest in agency features that measurably reduce coordination time or improve
the client experience.

This roadmap governs execution. Older plans remain valuable specifications and
evidence, but they do not independently set priority.

## Success definition

The replacement is complete only when all of the following are true:

1. A production operator can sign in and complete the authenticated owner flow.
2. A client/reviewer can complete the production review flow without receiving
   administrative data or controls.
3. Backup, restore, deployment, rollback, email, sharing, and integration checks
   have current evidence for the release being used.
4. At least one low-risk Ashbi client project completes from review creation to
   attributable sign-off using this product as the system of record.
5. A second project or an explicit 30-day operating window confirms that the
   first pilot was not a one-off success.
6. The old SaaS has no active project or retention dependency, its required data
   has been exported, and Cameron explicitly approves cancellation.
7. Ashbi is measuring the operating outcomes listed below.

## Ordered gates

### L0 — Make repository plans truthful

**Status:** complete on 2026-08-28

- Classify each top-level plan as governing, active implementation, completed
  evidence, historical reference, or parked.
- Remove stale and contradictory priorities from `TASK.md`.
- Keep this roadmap, `docs/plans/README.md`, and `TASK.md` aligned.

**Exit evidence:** the index accounts for every top-level plan, documentation
paths exist, `git diff --check` passes, and no other plan claims a competing
next implementation slice.

### L1 — Open and prove authenticated production access

**Status:** in progress; the SSE/POST state-deduplication fix passed its
authenticated live repetition on the exact deployed SHA. The 375px
owner-surface accessibility fix is verified and merged. Exact-candidate
preflight then exposed a nightly-prune rollback-retention defect. Pull request
#56 implements and verifies the release-safety fix; the reconciled current
`main` artifact still needs exact-SHA approval before production repetition can
resume broader owner/client QA and cleanup.

- Provision the first production operator through a bounded, documented,
  idempotent mechanism. Never commit or echo the password.
- Verify operator sign-in, CSRF/session handling, workspace/project setup,
  image review, website widget review, comment lifecycle, review rounds,
  sign-off, archive, managed sharing, notification preferences, and GitHub
  delivery using disposable production QA records.
- Verify the client/guest journey at desktop and mobile widths, including role
  redaction and keyboard operation.
- Remove every disposable production QA record and file, then verify cleanup.
- Recheck health, TLS, worker/cron state, backups, and retained rollback image.

**Exit evidence:** dated production-QA record tied to an exact deployed SHA,
with no unexplained console/request failures and verified cleanup.

**Execution checklist:**
`docs/qa/production-launch-checklist-2026-08-28.md` is the single ordered
operator record for L1 through L4. Its public baseline is current as of
2026-08-28. Provisioning and sign-in pass. The formerly failed reply persists
on release `26d906b512b43d25bea79846139aca9972d0abfc`. The deduplication
fix is released as `e3f9c4d12986da641b01f758316c84e43013b3d8`; its automated
race regression and authenticated live repetition both pass. The next open
production check is the failed 375px mobile interaction contract on that same
deployed SHA.

**Provisioning mechanism:** `scripts/provision-operator.cjs` is stdin-only,
idempotent for matching credentials, refuses implicit privilege escalation or
password replacement, and documents a trusted VPS-shell flow in `README.md`.
The production operator now exists and HTTPS sign-in passed. The active
credential is stored in Cameron's macOS Keychain rather than the repository,
deployment environment, command arguments, or evidence records.

**Current production finding:** workspace and reply CSRF fixes are deployed and
verified. The focused idempotent append is reviewed and released on exact SHA
`e3f9c4d12986da641b01f758316c84e43013b3d8`; its race regression passes. The
isolated production QA inventory remains intact with three distinct comments.
The authenticated live reply now renders exactly once before and after reload
and exists as one database row. Broader QA then exposed sub-16px form controls
and sub-44px interactive targets at 375px. The focused work is governed by
`mobile-dashboard-accessibility-2026-09-01.md`. Pull request #54 is implemented,
verified, and merged. Preflight then found the previously retained rollback image
had been removed by the shared host's nightly prune; remediation is governed by
`rollback-image-retention-2026-09-01.md` and merged through pull request #56. Do
not resume production QA until the reconciled current `main` SHA is explicitly
approved, deployed with a verified retainer, and the failed mobile check is
repeated successfully.

**Schema reconciliation note:** production now has 30 finished,
non-rolled-back migrations. The guarded cleanup removed the confirmed-empty
superseded `ReviewDocument` table; current PDF review uses `ReviewAsset`.

### L2 — Finish first-class PDF review

**Status:** local implementation and journey proof complete on 2026-08-28;
production repetition is blocked on L1

- Prove Poppler availability, timeout behavior, page/pixel limits, and cleanup
  in the exact production image.
- Implement authenticated bounded PDF upload and opaque source/page storage.
- Render PDF pages into the existing Page/Screenshot review model.
- Reuse existing pins, annotations, threads, sharing, notifications, rounds,
  and sign-off rather than creating a second review system.
- Complete local owner/client browser QA and production QA after L1.

**Exit evidence:** every validation item in
`docs/plans/pdf-review-2026-08-10.md` passes, including cleanup proof.

**Local checkpoint:** the exact Linux runner and all 28 checked-in migration
directories built, a two-page PDF rendered into naturally ordered
Page/Screenshot rows, an owner
placed a normal feedback pin, the 1280px/375px owner and 375px managed-share
views passed without console/request/overflow errors, and project deletion
removed the source PDF, rendered PNGs, work directory, and relational rows.
Production evidence remains part of L1 and must be tied to the deployed SHA.

### L3 — Run an internal client pilot

**Status:** pending L1 and owner selection of a low-risk project

- Choose one real Ashbi client site with a cooperative reviewer and reversible
  launch timing.
- Run the paid SaaS as a fallback, not a second system of record.
- Onboard the project, review the real staging site/assets, resolve feedback,
  obtain sign-off, and record every support question or workaround.
- Fix launch-blocking defects; defer speculative features.

**Exit evidence:** one completed review round, client sign-off, no lost feedback,
and a short pilot retrospective with measured outcomes.

### L4 — Replace and cancel the paid SaaS

**Status:** pending L3

- Validate a second project or a 30-day operating window.
- Export required historical data and confirm retention obligations.
- Move all active review work to Ashbi Visual Feedback.
- Confirm recovery ownership and client support instructions.
- Obtain Cameron's explicit approval before cancelling the subscription.

**Exit evidence:** no active dependency on the old SaaS, cancellation receipt,
and a recorded monthly cost saving.

### L5 — Improve Ashbi's business workflow

**Status:** discovery from pilot evidence; do not displace L1-L4

Prioritize only features supported by observed agency friction:

1. Review deadlines, reminders, and “waiting on client” visibility.
2. Stronger developer handoff and issue-to-deployment closure.
3. Client-facing progress and approval reporting.
4. Agency portfolio metrics and workload visibility.
5. Storage, retention, and usage controls needed for predictable operation.

Each material feature gets a dated implementation plan before code. Billing,
video review, generic folders, enterprise SSO/SCIM, AI-generated fixes, repository
write access, and npm publication remain parked until the pilot supplies a clear
business case and their separate approval boundaries are satisfied.

## Operating measures

Record these from the pilot onward:

- monthly SaaS cost eliminated;
- median feedback-to-resolution time;
- median time waiting for client sign-off;
- unresolved feedback at launch;
- review rounds per project;
- percentage of actionable feedback delivered to the development workflow;
- project-management hours spent per review round;
- client support questions and failed review attempts.

Metric definitions, evidence sources, pilot decision rules, the current
first-party pricing snapshot, access boundaries, and risk/decision registers are
maintained in `market-position-and-operating-model-2026-08-28.md`. That document
supports this roadmap and does not independently change gate priority.

## Plan reconciliation

| Classification | Plans |
|---|---|
| Governing | This roadmap; `agency-product-release-2026-08-07.md` as the release-gate specification |
| Active implementation | `pdf-review-2026-08-10.md` |
| Launch evidence with one remaining production gate | `release-candidate-operational-validation-2026-08-08.md` |
| Completed implementation evidence | comment lifecycle, image review uploads, review rounds, developer context, structured handoff, internal issue metadata, reliable integration delivery, native GitHub issue delivery, invitations/roles, workspace branding/client mode, client/site archive, managed public review links, public API/SDK, collaboration transport, project summary aggregation, role-aware notifications, local load rehearsal, and cross-browser/accessibility QA |
| Product reference | `market-position-and-operating-model-2026-08-28.md`; `markup-parity-and-agency-advantage-2026-08-07.md` |
| Historical reference | `docs/refactor/*`, `docs/qa/production-grade-assessment.md`, and the current security audit |
| Parked | AI-generated fixes, repository execution, billing/subscriptions, video review, generic folders, enterprise identity/compliance, analytics, and npm publication |

## Change discipline

- `TASK.md` is the current execution board; choose the highest unblocked item.
- `docs/qa/production-launch-checklist-2026-08-28.md` governs the production,
  pilot, and SaaS-exit evidence sequence once access is available.
- Completed plans are evidence, not a reason to repeat work.
- Production writes, account secrets, subscription cancellation, payment setup,
  npm publication, and client communications retain their explicit owner approval
  boundaries.
- A local pass is not production proof, and a public health check is not an
  authenticated workflow pass.
