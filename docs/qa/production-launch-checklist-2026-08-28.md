# Production launch, pilot, and SaaS-exit checklist — 2026-08-28

**Status:** live-comment deduplication verified in production; a mobile owner
accessibility defect blocks broader owner/client QA and cleanup
**Governing roadmap:**
`docs/plans/launch-and-saas-replacement-roadmap-2026-08-28.md`

This is the one execution checklist for roadmap gates L1 through L4. It does not
replace the deploy or incident runbooks. Record evidence here or in a dated copy;
do not turn an unchecked item green from local-only evidence.

## Current public baseline

Read-only verification on 2026-08-28 established all of the following:

- `https://markup.ashbi.ca/api/health` returned HTTP 200 and `status: ok`.
- The root page and `widget.js` returned HTTP 200 over trusted HTTPS.
- The certificate subject was `CN=markup.ashbi.ca`, issued by Let's Encrypt
  `YR1`, valid from 2026-08-08 through 2026-11-06.
- HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, Referrer Policy, and
  Permissions Policy headers were present.
- An anonymous `/workspaces` request produced the expected Next.js sign-in
  redirect boundary, while `/api/workspaces` directly returned HTTP 401 with an
  `Unauthorized` JSON response.
- The public `widget.js` SHA-256 was
  `b00a1efc1a0fc63f22fd0a133b28b5257468d4b5043acf39f288424241a9ffa9`,
  exactly matching `public/widget.js` in the release branch.
- The checked-in `ashbi.public-release.v1` verifier repeated all of these
  assertions successfully at 2026-08-28T15:44:26Z.

This proves public reachability and edge posture. It does not prove the
authenticated application release, its database migration, or any owner/client
journey.

## 2026-08-28 exact-SHA release record

- Pull request #41 passed Ashbi Local CI and GitGuardian, then merged without a
  bypass as `e4f8e4eb45017930969e9ba9f46e6100472f9a08`.
- The clean VPS checkout fast-forwarded to `main` at that exact commit.
- `scripts/deploy.sh` completed successfully. The healthy application container
  uses `markup-clone:e4f8e4eb45017930969e9ba9f46e6100472f9a08`, image ID
  `sha256:b68f4ba7c4578da9c35e4a9b274d6e8101a8bfadb1e6a593f7925186914fdf6a`,
  started at `2026-08-28T17:11:35.564767054Z`.
- The retained rollback is
  `markup-clone:e99b51ee3d57d8e291e121800e6845fec07825ce`, image ID
  `sha256:56427ce514d74de49b73fdd5cfd546372ce3fb14493f08dc692b447abda3639b`.
- Production has 29 finished, non-rolled-back migrations, including
  `20260828120000_add_pdf_review_assets`.
- That count is 28 migration directories in the deployed release plus the
  previously deployed `20260813103000_add_review_documents` history row from
  the superseded `codex/public-onboarding` implementation. Its
  `ReviewDocument` table exists with zero rows; current code uses the new,
  also-empty `ReviewAsset` table. The reviewed follow-up cleanup is merged but
  not yet deployed.
- The post-deploy `ashbi.public-release.v1` verification passed at
  `2026-08-28T17:12:03Z`.
- The private backup `markup-20260828T163040Z.dump` passed its remote catalog and
  checksum checks and its off-host copy passed SHA-256 verification at
  `ab335038316a1f5b13ba560712d7593c194da9c94b21d7b22d960d363316bfec`.
- Mailgun is configured. Fresh delivery-worker and integration-encryption keys
  are staged in the mode-0600 VPS `.env` and passed an exact-image shape/decode
  probe without printing values. They are not considered active until the next
  deployed container loads them and the protected worker endpoint is verified.

Repeat the same fail-closed verification from the exact release checkout before
and after deployment:

```bash
npm run verify:public-release
```

The verifier makes no writes. It refuses non-TLS public origins, validates the
health payload and browser security headers, proves `/workspaces` redirects an
anonymous caller and `/api/workspaces` returns 401, and compares the deployed
widget byte-for-byte by SHA-256 with the checked-out `public/widget.js`.

## 2026-08-28 follow-up release staging record

- Pull request #43 passed Ashbi Local CI and GitGuardian against exact head
  `9dae91753f67834ccd882f410c23240e1a787b07`, then merged without bypass as
  `a03b87d8d05db0a69b050c75d05baf383d611fea`.
- The merge adds the fail-closed empty `ReviewDocument` cleanup and corrects
  Docker environment-file examples/tests so quotes cannot enter runtime values.
- The active Mailgun account reports `ashbi.ca` as active and enabled; the stale
  nonexistent `mg.ashbi.ca` setting is corrected in the private VPS `.env`.
  The delivery-worker and integration-encryption secrets remain staged and
  passed an exact-image, network-disabled shape probe without revealing values.
- Immediately after merge, the clean VPS checkout remained on current deployed
  release `e4f8e4eb45017930969e9ba9f46e6100472f9a08`; production had zero
  `ReviewDocument` rows and 29 finished migrations.
- Rollback-image and edge/TLS preflights passed. The public health endpoint
  returned HTTP 200, and `ashbi.public-release.v1` passed from an exact detached
  checkout of the merged release at `2026-08-28T19:19:44.968Z`.
- Fresh backup `markup-20260828T191950Z.dump` passed remote catalog and checksum
  validation. Its mode-0600 off-host copy passed SHA-256 verification at
  `dbe4f2ebbf07f9ddda02b5b38a9a6280972c3ccf06d6c1d739a6fedf1a781518`.
- No deployment, email, integration delivery, or production data mutation was
  performed during staging. Exact owner approval is required immediately before
  the exact then-current `main` containing code-bearing merge `a03b87d8...` is
  deployed.

## 2026-08-28 approved follow-up deployment record

- Cameron approved deployment of the frozen `main` release
  `da6bae53949edd62f4996a161189e3bd38bbf8b5` and continuation of the full
  internal-adoption program. This approval did not authorize sending external
  email, contacting a client, changing customer-visible pricing, or cancelling
  the incumbent SaaS.
- Immediately before deployment, `ReviewDocument` still had zero rows, the
  checkout and approved remote SHA matched, trusted edge/TLS and rollback
  preflights passed, and the running application was healthy.
- Fresh mode-0600 backup `markup-20260828T210514Z.dump` passed remote checksum
  and `pg_restore --list` validation. Its off-host copy independently passed
  SHA-256 verification at
  `f06d0dbb98e395d0a6dac3582a9f1912ed9f1c51ea779939d587d3ff07e1430e`.
- `scripts/deploy.sh` completed with `DEPLOY OK` at 2026-08-28T21:08:17Z. The
  healthy container uses immutable image
  `markup-clone:da6bae53949edd62f4996a161189e3bd38bbf8b5`, image ID
  `sha256:c9b98c39d6337fc42542272b2910a1ca8482e4f77b34fe0fe6e428ec14f5bdb9`.
- The cleanup migration completed atomically. Production now has 30 finished,
  non-rolled-back migrations, and `ReviewDocument` is absent.
- The retained rollback remains
  `markup-clone:e4f8e4eb45017930969e9ba9f46e6100472f9a08`, image ID
  `sha256:b68f4ba7c4578da9c35e4a9b274d6e8101a8bfadb1e6a593f7925186914fdf6a`.
- The deployed container loaded `ashbi.ca` and both independent 43-character
  runtime secrets. A protected worker request returned zero claimed, succeeded,
  retried, or dead-lettered deliveries. The worker and prune crons are installed,
  the obsolete Caddy guard is retired under Traefik, 54 GB is free, and recent
  application logs contain no error/fatal/panic matches.
- `ashbi.public-release.v1` passed from the exact deployed checkout at
  2026-08-28T21:09:17.627Z, including trusted HTTPS/security headers, public
  health, explicit anonymous API denial, and byte-for-byte widget provenance.

## 2026-08-28 approved workspace-CSRF deployment record

- Pull request #48 passed Ashbi Local CI and GitGuardian, then merged as exact
  `main` SHA `8030d6bc378d4f7523400d2ef7a66cbe4f82ad0a`. Cameron explicitly approved
  deployment of that frozen SHA; the approval did not authorize external email,
  client communication, pricing changes, purchases, or SaaS cancellation.
- Fresh mode-0600 backup `markup-20260828T220914Z.dump` passed remote checksum
  and `pg_restore --list` validation. Its off-host copy independently passed
  SHA-256 verification at
  `6382c540ced005c2ddb0e8694aefa189ff7a9c067c90180d617d71aca1390143`.
- The first deploy invocation stopped before build/restart because the release
  checkout contained one untracked rollback-metadata file accidentally created
  by the preflight command. That exact QA-created file was removed; the old
  container remained healthy throughout, and the clean retry completed with
  `DEPLOY OK` at 2026-08-29T03:28:04Z.
- The healthy container now uses immutable image
  `markup-clone:8030d6bc378d4f7523400d2ef7a66cbe4f82ad0a`, image ID
  `sha256:965e1460befea599bf9fcd2a15a6854146576a1a37eabe15df4bb8466f38562d`.
  The retained rollback is
  `markup-clone:da6bae53949edd62f4996a161189e3bd38bbf8b5`.
- Production remains at 30 finished, non-rolled-back migrations with
  `ReviewDocument` absent. The protected worker returned zero claimed,
  succeeded, retried, or dead-lettered deliveries; worker and prune cron jobs
  are installed; recent application logs contain no error/fatal/panic matches.
- `ashbi.public-release.v1` passed after deployment at
  2026-08-29T03:28:44.573Z, including trusted HTTPS/security headers, public
  health, explicit anonymous API denial, and byte-for-byte widget provenance.

## 2026-08-29 approved PinThread-CSRF deployment record

- Pull request #49 passed Ashbi Local CI and GitGuardian, then merged without
  bypass as exact `main` SHA `26d906b512b43d25bea79846139aca9972d0abfc`.
  Cameron explicitly approved deployment of that frozen SHA; the approval did
  not authorize external email, client communication, pricing changes,
  purchases, or SaaS cancellation.
- Fresh mode-0600 backup `markup-20260829T073844Z.dump` passed remote checksum
  and `pg_restore --list` validation. Its off-host copy independently passed
  SHA-256 verification at
  `46c15d8c2418e212d0b11e6a69eaad7d1fa2bb25b5113376bce7f57f6174e912`.
- Final preflight matched clean local/remote `main`, the four completed PR
  checks, healthy `8030d6b...` production image, trusted TLS, 30 clean
  migrations, zero delivery queue, valid runtime-secret shapes, and exactly the
  expected isolated QA workspace/client/site inventory.
- `scripts/deploy.sh` completed with `DEPLOY OK` at
  2026-08-29T07:41:11Z. The healthy container uses immutable image
  `markup-clone:26d906b512b43d25bea79846139aca9972d0abfc`, image ID
  `sha256:ebd5d3d243ef63389a7a7468b430b634234059fc0e6983f52c97d5a222e3e98f`.
  The retained rollback is
  `markup-clone:8030d6bc378d4f7523400d2ef7a66cbe4f82ad0a`.
- Production remains at 30 finished, non-rolled-back migrations with
  `ReviewDocument` absent. The protected worker returned zero claimed,
  succeeded, retried, or dead-lettered deliveries; worker and prune cron jobs
  are installed; recent application logs contain no error/fatal/panic matches.
- `ashbi.public-release.v1` passed after deployment at
  2026-08-29T07:41:32.911Z, including trusted HTTPS/security headers, public
  health, explicit anonymous API denial, and byte-for-byte widget provenance.

## 2026-08-29 approved live-comment-dedup deployment record

- Pull request #50 passed Ashbi Local CI and GitGuardian, then merged without
  bypass as exact `main` SHA
  `e3f9c4d12986da641b01f758316c84e43013b3d8`. Cameron explicitly approved
  deployment of that frozen SHA; the approval did not authorize external email,
  client communication, pricing changes, purchases, or SaaS cancellation.
- Fresh mode-0600 backup `markup-20260829T082217Z.dump` passed remote checksum
  and `pg_restore --list` validation. Its off-host copy independently passed
  SHA-256 verification at
  `2e95060c015af7f0548fdf20065537a8223522d3d34b12f4bc7f3a2727c02d8c`.
- Final preflight matched clean local/remote `main`, the four completed PR
  checks, healthy `26d906b...` production image, trusted TLS, 30 clean
  migrations, zero delivery queue, and exactly the expected isolated QA
  workspace/client/site/pin inventory with two distinct comments.
- `scripts/deploy.sh` completed with `DEPLOY OK` at
  `2026-08-29T08:28:22Z`. The healthy container uses immutable image
  `markup-clone:e3f9c4d12986da641b01f758316c84e43013b3d8`, image ID
  `sha256:8718bfa28b62f949515e27dad48a093ac071e06a4c4dbdeb9a44602ca2790dda`.
  The retained rollback is
  `markup-clone:26d906b512b43d25bea79846139aca9972d0abfc`, image ID
  `sha256:ebd5d3d243ef63389a7a7468b430b634234059fc0e6983f52c97d5a222e3e98f`.
- A post-deploy verification command accidentally refreshed the private
  rollback pointer to the current image. The previous immutable image had not
  been removed or retagged; its exact tag and image ID were reverified and the
  mode-0600 pointer was atomically restored before QA continued.
- Production remains at 30 finished, non-rolled-back migrations with zero
  failed/rolled-back rows. The worker and prune cron jobs are installed, the
  delivery queue is empty, the edge route is healthy, and the isolated QA
  inventory remained unchanged.
- `ashbi.public-release.v1` passed after deployment at
  `2026-08-29T08:29:43.506Z`. A fresh read-only repetition on
  `2026-09-01T01:47:35.442Z` again passed trusted HTTPS/security headers,
  public health, explicit anonymous API denial, and byte-for-byte widget
  provenance.

## Release identity and approval

### 2026-09-01 mobile-accessibility candidate staging record

- Pull request #54 passed Ashbi Local CI and GitGuardian, then merged without
  bypass as exact `main` SHA
  `fa73b968fde3649c7f72c0ffaccd2397e383cff1`. Its tree matches reviewed head
  `a9572f2c4db2256254b2cc0d11b00bc7dd63b832`.
- The focused 375px contract passes Chromium, Firefox, and WebKit. The full
  Vitest suite passed 957 tests across 139 files; ESLint, TypeScript, Prisma
  validation, package/widget builds, the production build, and diff checking
  passed.
- The broader E2E run passed 10 of 12 files. The remaining WebKit keyboard-tab
  mismatch predates this change and is not represented as a green full-suite
  result.
- The current Prisma tooling chain reports the high-severity
  [`deepmerge-ts@7.1.5` recursive-object
  advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Application source does not
  invoke it, and `deepmerge-ts` is absent from the standalone and running
  production runtime trees. This is tracked as an upstream build/config-tooling
  upgrade rather than an accepted production request-path risk.
- A fresh read-only public verifier passed from the candidate checkout at
  `2026-09-01T10:18:27Z`. Production remains unchanged on exact SHA
  `e3f9c4d12986da641b01f758316c84e43013b3d8` with retained rollback
  `26d906b512b43d25bea79846139aca9972d0abfc`.
- No backup, deployment, production mutation, email, integration delivery, or
  client communication was performed during staging. The earlier standalone
  `fa73b968...` approval request is superseded by the consolidated release
  artifact described below.

### 2026-09-01 rollback-retention preflight finding

- The documentation reconciliation merged through pull request #55 as
  `cf1718305bba0117dd57c63678cbb3e3c587019c`; its tree matches its checked head
  and both required checks passed. Production remained unchanged.
- A fresh read-only host preflight found the documented
  `markup-clone:26d906b512b43d25bea79846139aca9972d0abfc` rollback tag and image
  ID absent while the private pointer still named them.
- Root cause is the shared nightly job
  `docker image prune -af --filter "until=24h"`. Docker removes images not
  referenced by any container, so an immutable source-SHA tag alone did not
  preserve the prior rollback artifact.
- The current healthy production image
  `markup-clone:e3f9c4d12986da641b01f758316c84e43013b3d8`, image ID
  `sha256:8718bfa28b62f949515e27dad48a093ac071e06a4c4dbdeb9a44602ca2790dda`,
  remains present and exactly matches the running container. It can become the
  next rollback only after a stopped retainer references it before replacement.
- `docs/plans/rollback-image-retention-2026-09-01.md` governs the focused fix.
  Pull request #56 merged the verified change without bypass as
  `35a105073148ed3107b6fb2f8c04ebb3084c1d3d`; Ashbi Local CI and GitGuardian
  passed and its merge tree matches the tested head.
- The post-merge read-only snapshot confirmed production is still healthy and
  clean on `e3f9c4d...`, its image ID still matches, PostgreSQL is ready with 30
  finished and zero rolled-back migrations, the trusted Traefik edge passes,
  and the retainer is not yet present. Creating it remains part of the exact
  approval window and must succeed before the running container is replaced.
- Freeze the current `main` SHA after this documentation-only reconciliation
  and request a new exact-artifact approval. No backup, checkout change,
  retainer creation, deployment, or production QA write has occurred yet.

- [x] The launch pull request is no longer draft, all required checks pass, and
  the approved code is merged without bypassing an unexplained CI failure.
- [x] Record the exact 40-character merged commit SHA:
  `e3f9c4d12986da641b01f758316c84e43013b3d8`.
- [x] The VPS checkout authenticates to Git, is on the intended release branch,
  fast-forwards to that SHA, and is clean in both content and file mode.
- [x] Release operator: Codex acting under Cameron Ashley's approval; release
  window began with the backup at `2026-08-28T16:30:40Z`; Cameron Ashley remains
  the rollback decision owner.
- [x] Keep the current paid visual-feedback SaaS active as the pilot fallback.

## Read-only host preflight

Run `docs/DEPLOY-RUNBOOK.md` items 1 through 10 from a trusted VPS shell. In
particular, do not print `.env` values. Record:

- [x] active edge owner and successful `edge-proxy-preflight.sh verify`;
- [x] running PostgreSQL and healthy application containers;
- [x] current immutable application image tag and image ID recorded above;
- [x] retained rollback image tag and image ID recorded above;
- [x] current finished migration count: 30;
- [x] 54 GB free and expected `/data/screenshots` mount present;
- [x] prune and integration-delivery cron jobs installed, both Ashbi Local CI
  services active, and recent application logs without repeated failures;
- [x] private database backup filename, checksum verification, and off-host copy
  destination.

Any missing rollback proof, untrusted TLS, dirty checkout, failed backup, or
unhealthy dependency is a release stop.

## Deploy the exact release

- [x] Run `bash scripts/deploy.sh` from `/root/markup-clone` on the VPS.
- [x] Confirm the log ends with `DEPLOY OK: <exact SHA>`.
- [x] Confirm the running container uses `markup-clone:<exact SHA>` and not only
  the mutable `latest` tag.
- [x] Confirm all 30 migrations, including
  `20260828120000_add_pdf_review_assets` and
  `20260828180000_drop_superseded_review_document`, are recorded as finished.
- [x] Repeat local-container and public health checks with trusted TLS.
- [x] Run `npm run verify:public-release` from the exact deployed checkout and
  retain its `ashbi.public-release.v1` JSON output with the release evidence.
- [x] Confirm the pruning and integration-delivery jobs were installed and are
  operating without a repeated error.

## Provision the first operator

Use the stdin-only mechanism in `README.md` from a trusted local/VPS boundary.
Do not put the password in chat, shell history, argv, an environment variable,
a plaintext file, or this evidence record. The approved production execution
generated the active replacement in memory and stored it in Cameron's macOS
Keychain.

- [x] Provisioning created the operator and an immediate safety rotation replaced
  the first generated value after it appeared in terminal output. The exposed
  value is invalid; the replacement is stored in macOS Keychain without being
  recorded here.
- [x] The account can sign in over HTTPS and receives an operator session.
- [x] A synthetic invalid login failed with the same safe
  `invalid email or password` response, without leaking whether an email exists.

### Authenticated QA start — 2026-08-28T21:45Z

- Exact deployed release: `da6bae53949edd62f4996a161189e3bd38bbf8b5`.
- Operator session: `cameron@ashbi.ca`, role `operator`, verified over trusted
  HTTPS.
- Attempted disposable prefix: `QA-20260828T214548285Z`.
- Workspace creation returned HTTP 403 `Invalid CSRF token` before creating a
  row. A reload and one bounded retry returned the same result; no further
  production writes were attempted.
- Root cause: `NewWorkspaceForm` does not call the existing
  `dashboardHeaders()` helper, so its POST omits `X-CSRF-Token`. The equivalent
  team and project forms already use the helper.
- Disposition: launch-blocking defect. The focused fix and regression test pass
  locally; resume this checklist only after reviewed merge, exact release
  approval, deployment, and successful repetition of this first write.

### Authenticated QA resume — 2026-08-29T03:29Z

- Exact deployed release:
  `8030d6bc378d4f7523400d2ef7a66cbe4f82ad0a`.
- Repeated the formerly failed workspace write first. Disposable workspace
  `QA-20260829T032956609Z Ashbi` was created successfully as database ID
  `40de0331-753b-46ac-85c8-9a820bb118c8`, proving the release fix in production.
- The operator then created disposable client account
  `35ee3ac4-ec23-47e0-8913-fba4068825fc`, site
  `deb1292b-0517-4d59-988c-e1d7149e26f8`, the first review round, an 800x600
  image review, and feedback pin `b108f5a3-da2b-4b70-a303-a67f4a019983`.
  Image upload, pin creation, high-priority metadata, and tags `qa` and
  `contrast` persisted.
- The first dashboard reply did not persist after two bounded submit attempts;
  the database still contained only the original pin comment. Source review
  showed that `PinThread` omitted `dashboardHeaders()` from comment creation and
  pasted-attachment upload, while comment creation also ignored non-OK
  responses. Broader QA stopped at this first failure.
- Focused branch `fix/pin-thread-csrf` adds CSRF headers to both writes, surfaces
  reply failures, and includes regression coverage for both request shapes.
  The full 139-file/954-test suite, ESLint, Prisma validation, widget build,
  shared-package builds, Next.js webpack production build, and TypeScript pass.
- Resume only after reviewed merge, exact release approval, deployment, and a
  successful repetition of the reply. The disposable inventory above remains
  isolated for that retest and must be removed through the product before L1 is
  closed.

### Authenticated QA resume — 2026-08-29T07:41Z

- Exact deployed release:
  `26d906b512b43d25bea79846139aca9972d0abfc`.
- Independent post-deploy verification confirmed exact image/checkout identity,
  a healthy container, trusted TLS, 30 clean migrations, retained rollback,
  installed cron jobs, zero delivery queue, zero worker claims, no recent
  error/fatal/panic log matches, passing public provenance, and unchanged
  isolated QA inventory.
- Before the retest, feedback pin
  `b108f5a3-da2b-4b70-a303-a67f4a019983` had exactly one comment. One bounded
  dashboard reply then persisted successfully: the database advanced to two
  distinct comment IDs and a reload rendered the new reply exactly once. This
  proves the PinThread CSRF fix.
- Before reload, the live thread rendered that one persisted reply twice. The
  defect is transient client state, not duplicate database data: the SSE event
  and POST response both call the parent append path, which did not deduplicate
  by comment ID. Broader QA stopped at this first failure.
- Focused branch `fix/live-comment-dedup` makes the parent append idempotent by
  comment ID. Its regression test reproduces simultaneous SSE and POST delivery
  and asserts one visible reply.
- Resume only after reviewed merge, exact release approval, deployment, and a
  successful live reply without duplication. The disposable inventory remains
  isolated for that retest and must be removed through the product before L1 is
  closed.

### Authenticated QA resume — 2026-09-01T01:47Z

- Exact deployed release:
  `e3f9c4d12986da641b01f758316c84e43013b3d8`.
- Pull request #50, exact local/GitHub/VPS identity, healthy immutable container,
  trusted edge, 30 finished migrations, zero failed migrations, empty delivery
  queue, retained `26d906b...` rollback image, and public widget provenance were
  reverified before the next production write.
- The isolated inventory remains exactly one workspace, client account, site,
  and pin, with two comments and two distinct comment IDs. No additional reply
  or broader QA mutation has been made on this release yet.
- The focused production-code regression still passes all 11 tests in
  `ScreenshotView-keyboard.test.tsx`. The live browser repetition remains
  required because local component evidence cannot prove the production-rendered
  SSE/POST path.
- Chrome reaches the trusted production sign-in form but does not carry the
  earlier operator session. Resume by signing in through the protected browser
  flow, then submit one uniquely labelled QA reply and assert it renders exactly
  once before reload, persists as one new database row, and remains exactly once
  after reload. Stop again on any mismatch.

### Authenticated QA resume — 2026-09-01T09:43Z

- Signed in as the production operator through the trusted Chrome context on
  exact deployed release `e3f9c4d12986da641b01f758316c84e43013b3d8`.
- Posted one uniquely labelled QA reply. It rendered exactly once before reload,
  the database advanced from two to three comments with three distinct IDs and
  exactly one row matching the test text, and it rendered exactly once after
  reload. The live SSE/POST deduplication gate passes.
- At 1280x800, the owner page had no horizontal overflow, no overflowing
  element, and no console error. At 375x812, it still had no horizontal overflow
  or console error and the reply still rendered once.
- The 375px audit found 18 visible form controls below 16px and 24 visible
  interactive targets below 44px in at least one dimension. Broader production
  mutation stopped at this first new launch-blocking failure.
- Focused remediation is governed by
  `docs/plans/mobile-dashboard-accessibility-2026-09-01.md`. Resume by deploying
  a reviewed, explicitly approved exact release and repeating this failed mobile
  check first.

## Disposable authenticated QA

Prefix every temporary name with `QA-<UTC timestamp>` and maintain an inventory
of every created database record, upload, share, and external issue so cleanup is
auditable. Use a private/incognito client context separate from the owner context.

### Owner desktop and mobile

- [ ] Sign in, create a disposable workspace/team/project, and reopen it after a
  fresh session.
- [ ] Upload a supported image; add, edit, resolve, reopen, and delete feedback.
- [ ] Create a second review round, preserve earlier history, and sign off the
  active round.
- [ ] Upload a two-page PDF; verify natural page order, place feedback on a
  rendered page, and confirm the source PDF is never publicly addressable.
- [ ] Review at 1280px and 375px with no unexplained console error, failed
  request, keyboard trap, or horizontal overflow.
- [ ] Exercise archive/unarchive, notification preferences, and the website
  widget flow on a disposable target.

### Client/reviewer desktop and mobile

- [ ] Open only the managed share/client surface at 1280px and 375px.
- [ ] Create and reply to feedback, attach an allowed image, resolve only when
  the role permits it, and complete sign-off.
- [ ] Verify keyboard navigation, focus visibility, touch targets, and readable
  form controls.
- [ ] Verify the client cannot enumerate members, integrations, API tokens,
  operator controls, private file keys, audit-only fields, or another project.
- [ ] Verify an expired/revoked share stops working and does not reveal project
  data.

### Delivery and operations

- [ ] Send one bounded test through the configured notification path and verify
  its safe delivery record.
- [ ] If GitHub delivery is part of the pilot, create one clearly labelled QA
  issue, verify attribution and the exact-pin link, then close/delete it if the
  repository policy permits. Never paste the integration token.
- [ ] Verify backup, restore documentation, retained rollback image, application
  logs, database health, disk space, and worker/cron state again after the
  journey.

## Cleanup and evidence

- [ ] Delete the disposable project through the product and verify its PDF
  source, rendered PNGs, image uploads, private work directory, shares, comments,
  pins, review assets, pages, screenshots, and relational rows are gone.
- [ ] Remove or close every external QA artifact and revoke any disposable share
  or token.
- [ ] Confirm no `QA-<UTC timestamp>` record or file remains.
- [ ] Record deployed SHA, UTC start/end, browsers and viewport sizes, migration
  count, backup checksum location, rollback image, health results, console/request
  findings, delivery result, cleanup queries, defects, and operator sign-off.

L1 and the production portion of L2 are complete only after this evidence is
dated and tied to the deployed SHA.

## First client pilot

Create a dated copy of `docs/qa/client-pilot-record-template.md` before inviting
the reviewer. It is the evidence record for the baseline, journey, measurements,
failures, cleanup, retrospective, and L4 decision; this checklist remains the
gate index.

- [ ] Cameron selects one low-risk active Ashbi project, one cooperative client
  reviewer, a reversible review window, and the old SaaS fallback.
- [ ] Define the project's success threshold and baseline: current SaaS cost,
  expected review rounds, recent feedback-to-resolution time, and coordination
  hours.
- [ ] Use Ashbi Visual Feedback as the single system of record for the round;
  use the old SaaS only if rollback is necessary.
- [ ] Complete onboarding, review, resolution, developer handoff, and attributable
  client sign-off with no lost feedback.
- [ ] Record support questions, workarounds, defects, time waiting on the client,
  time to resolution, unresolved items at launch, and management hours.
- [ ] Fix launch-blocking defects; turn repeated friction into a dated L5 feature
  plan instead of building from speculation.

## SaaS replacement decision

- [ ] Complete either a second successful project or a 30-day operating window.
- [ ] Inventory every active project, user, integration, export, attachment,
  retention requirement, and billing owner in the old SaaS.
- [ ] Export required history and verify it is readable and stored under Ashbi's
  retention policy.
- [ ] Move all active work, document recovery/support ownership, and confirm no
  link or workflow still depends on the old SaaS.
- [ ] Present the pilot evidence and monthly saving to Cameron.
- [ ] Obtain Cameron's explicit cancellation approval.
- [ ] Cancel, save the receipt/final invoice, remove obsolete access, and record
  the realized monthly cost saving.

No earlier checkpoint authorizes cancellation.
