# Mobile dashboard accessibility — 2026-09-01

**Status:** active implementation
**Parent:** governing roadmap L1
**Production finding:** exact release
`e3f9c4d12986da641b01f758316c84e43013b3d8`

## Outcome

Make the authenticated owner review surface usable at phone widths without
browser text zoom, undersized touch targets, horizontal overflow, or a keyboard
regression. Resume production QA only after the reviewed fix is deployed as an
explicitly approved exact release.

## Evidence and problem

The live SSE/POST reply repetition passed on 2026-09-01: one uniquely labelled
reply rendered once before reload, existed as exactly one database row, and
rendered once after reload. Broader QA then continued on the same isolated site.

At 1280x800, the owner page had no horizontal overflow, no overflowing element,
and no console error. At 375x812 it still had no horizontal overflow or console
error, but the rendered page exposed two launch-blocking mobile interaction
failures:

- 18 visible form controls computed below 16px, including the reply field,
  author field, issue selectors, upload input, and integration inputs;
- 24 visible interactive targets measured below 44px in at least one dimension,
  including Site settings, screenshot tabs, Recapture, pin markers, comment
  actions, and the thread close control.

The accepted screenshot evidence is
`/var/folders/7t/n9d5ql7j5tqbwf_1cr6jsmr80000gp/T/markup-mobile-a11y-audit-2026-09-01/01-owner-pin-thread-375.png`.

## Scope

1. Establish a shared mobile form-control baseline of at least 16px for inputs,
   selects, and textareas.
2. Establish a shared mobile interaction baseline of at least 44x44px for
   buttons and the primary review links/controls.
3. Keep compact visual styling at tablet/desktop widths.
4. Retain the viewport-sized mobile feedback thread, visible focus treatment,
   Escape close behavior, focus return, comment deduplication, and zero
   horizontal overflow.
5. Add focused regression coverage for the shared CSS contract and the
   screenshot pin/thread controls that failed live QA.

## Acceptance

- At 375x812, every visible form control on the owner project surface computes
  to at least 16px.
- At 375x812, every visible button and primary interactive control on the owner
  review surface has a 44x44px minimum target.
- Site settings, screenshot tabs, Recapture, pin markers, thread close, issue
  fields, comment actions, reply, author, and file upload meet the contract.
- No horizontal overflow, keyboard trap, unexpected request failure, or console
  error is introduced.
- The focused component/style tests, full Vitest suite, ESLint, Prisma
  validation, package/widget builds, Next production build, TypeScript, and
  diff check pass.
- The merged release remains a candidate until Cameron explicitly approves the
  exact 40-character SHA for production deployment.

## Release sequence

1. Implement and verify locally on a focused branch.
2. Review through a pull request and require all repository checks.
3. Freeze the merged SHA and request exact-artifact deployment approval.
4. Run fresh backup, rollback, edge, migration, delivery-queue, and clean-tree
   preflight.
5. Deploy only the approved SHA, then repeat the failed 375px check first.
6. Resume the remaining owner/client L1 journey only after the mobile contract
   passes in production.

## Boundaries

- No production deployment is authorized by this plan or by broad permission to
  continue working.
- Do not send external email or integration deliveries during this fix.
- Do not delete the isolated QA inventory until the full product cleanup step.
- Keep the incumbent paid SaaS active; cancellation remains gated by the pilot,
  second-project/30-day proof, export, and separate approval.
