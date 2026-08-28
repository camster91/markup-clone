# Production launch, pilot, and SaaS-exit checklist — 2026-08-28

**Status:** exact-SHA production release deployed; operator credential entry pending
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
  also-empty `ReviewAsset` table. Remove the superseded table only through a
  reviewed follow-up migration.
- The post-deploy `ashbi.public-release.v1` verification passed at
  `2026-08-28T17:12:03Z`.
- The private backup `markup-20260828T163040Z.dump` passed its remote catalog and
  checksum checks and its off-host copy passed SHA-256 verification at
  `ab335038316a1f5b13ba560712d7593c194da9c94b21d7b22d960d363316bfec`.

Repeat the same fail-closed verification from the exact release checkout before
and after deployment:

```bash
npm run verify:public-release
```

The verifier makes no writes. It refuses non-TLS public origins, validates the
health payload and browser security headers, proves `/workspaces` redirects an
anonymous caller and `/api/workspaces` returns 401, and compares the deployed
widget byte-for-byte by SHA-256 with the checked-out `public/widget.js`.

## Release identity and approval

- [x] The launch pull request is no longer draft, all required checks pass, and
  the approved code is merged without bypassing an unexplained CI failure.
- [x] Record the exact 40-character merged commit SHA:
  `e4f8e4eb45017930969e9ba9f46e6100472f9a08`.
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
- [x] current finished migration count: 29;
- [x] 79 GB free and expected `/data/screenshots` mount present;
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
- [x] Confirm all 29 migrations, including
  `20260828120000_add_pdf_review_assets`, are recorded as finished.
- [x] Repeat local-container and public health checks with trusted TLS.
- [x] Run `npm run verify:public-release` from the exact deployed checkout and
  retain its `ashbi.public-release.v1` JSON output with the release evidence.
- [x] Confirm the pruning and integration-delivery jobs were installed and are
  operating without a repeated error.

## Provision the first operator

Run the stdin-only command in `README.md` from the trusted VPS shell. Cameron
enters the operator email and password at the local prompts. Do not put the
password in chat, shell history, argv, an environment variable, a file, or this
evidence record.

- [ ] Provisioning reports `created` or the expected idempotent `unchanged`.
- [ ] The account can sign in over HTTPS and receives an operator session.
- [x] A synthetic invalid login failed with the same safe
  `invalid email or password` response, without leaking whether an email exists.

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
