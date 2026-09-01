# Mobile dashboard accessibility — 2026-09-01

**Status:** implemented and verified; merged candidate awaiting exact-SHA
deployment approval
**Parent:** governing roadmap L1
**Production finding:** exact release
`e3f9c4d12986da641b01f758316c84e43013b3d8`
**Merged candidate:** `fa73b968fde3649c7f72c0ffaccd2397e383cff1`

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

1. [x] Implement and verify locally on a focused branch.
2. [x] Review through pull request #54 and require all repository checks.
3. [x] Freeze merged SHA
   `fa73b968fde3649c7f72c0ffaccd2397e383cff1` and request exact-artifact
   deployment approval.
4. Run fresh backup, rollback, edge, migration, delivery-queue, and clean-tree
   preflight.
5. Deploy only the approved SHA, then repeat the failed 375px check first.
6. Resume the remaining owner/client L1 journey only after the mobile contract
   passes in production.

## Verification record

- Pull request #54 merged without bypass as exact `main` SHA
  `fa73b968fde3649c7f72c0ffaccd2397e383cff1`; its tree matches the reviewed
  head `a9572f2c4db2256254b2cc0d11b00bc7dd63b832`.
- Ashbi Local CI and GitGuardian passed. The optional Cursor checks were neutral
  because their trial quota was unavailable; neither is a required repository
  check.
- The focused mobile contract passes in Chromium, Firefox, and WebKit. The full
  Vitest suite passed 957 tests across 139 files; ESLint, TypeScript, Prisma
  validation, package/widget builds, the production build, and diff checking
  also passed.
- The broader E2E run passed 10 of 12 files. Its remaining WebKit keyboard-tab
  mismatch predates this change; the new mobile test initially exposed and then
  verified the repaired WebKit select height. Do not represent the full E2E
  suite as green.
- `npm audit --omit=dev --audit-level=high` reports the current Prisma CLI chain
  through `@prisma/config` and `deepmerge-ts@7.1.5`. The
  [advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) requires
  attacker-controlled recursive object graphs. Application source does not
  call that library, and `deepmerge-ts` is absent from the standalone and
  running production runtime trees. Track the upstream tooling upgrade, but do
  not treat this non-runtime build/config dependency as an accepted production
  request-path risk.
- Production remains unchanged on exact SHA
  `e3f9c4d12986da641b01f758316c84e43013b3d8`. No deployment is implied by the
  merge or by this verification record.

## Boundaries

- No production deployment is authorized by this plan or by broad permission to
  continue working.
- Do not send external email or integration deliveries during this fix.
- Do not delete the isolated QA inventory until the full product cleanup step.
- Keep the incumbent paid SaaS active; cancellation remains gated by the pilot,
  second-project/30-day proof, export, and separate approval.
