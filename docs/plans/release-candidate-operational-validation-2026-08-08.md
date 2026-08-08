# Release candidate operational validation — 2026-08-08

**Status:** local implementation complete; final gates and production actions remain approval-gated
**Parent:** `docs/plans/agency-product-release-2026-08-07.md` Gates 2 and 3
**Production:** untouched; Git, npm, and deployment remain approval-gated

## Outcome

Produce a locally verified release candidate whose build is intentional, whose
agency setup can be reused safely, and whose operator can prove recovery without
experimenting on production.

## Scope

1. Remove the widget `publicDir` overlap warning without changing its output URL.
2. Scope or explicitly exclude runtime disk-media reads from Next.js tracing in
   the supported Next 16 form, with regression coverage for both media routes.
3. Add reusable, validated workspace review defaults that prefill new review
   rounds while preserving an explicit per-round override. Branding ownership,
   role redaction, and historical round immutability remain unchanged.
4. Add local/VPS-safe PostgreSQL backup and restore scripts with explicit target,
   integrity checks, restrictive files, no embedded credentials, and refusal to
   overwrite a non-empty database unless the operator opts in.
5. Expand the deployment runbook with backup, restore, rollback, observability,
   rate-limit, and incident drills. Exercise every read/write drill only against
   the disposable local Compose stack and record exact evidence.
6. Rebuild the Linux production image from the Windows checkout, apply all
   migrations from zero, verify health, rehearse upgrade preservation, and run
   the primary authenticated owner/client/browser-SDK journey.

## Verification

- Strict RED/GREEN tests for defaults, warning configuration, script contracts,
  destructive-target guards, and documentation commands.
- Full Vitest, lint, TypeScript, Prisma validation, dependency audit, package and
  Next production builds with no new warnings.
- Disposable backup → mutate → guarded restore → row/content verification.
- Docker image/build/migrations/health and authenticated Chromium QA at desktop
  and mobile widths with zero application console or unexpected request errors.

## Out of scope

- Off-host backup-provider credentials or scheduling a live cron job.
- Automatic production restore, production data access, npm publishing, commit,
  push, deploy, public release, or declaring broad file/enterprise parity.

## Completion evidence

- Warning-free widget, package, and Next production builds. Runtime media remains
  on external mounts and is explicitly excluded from standalone tracing using
  the installed Next 16 mechanism.
- Owner-managed client-account review defaults require a bounded `{n}` template,
  optionally start new rounds paused, prefill the next numbered round, permit an
  explicit override, and are absent from client responses and controls.
- Additive migration 24 applied over an existing client account without data
  loss and as part of a clean empty-database install.
- PostgreSQL custom-format backup/checksum/guarded restore was exercised locally.
  The refusal path returned exit 4 without mutation; the confirmed path restored
  the original client-account values and all 24 migration records. Client tools
  are pinned to PostgreSQL 16.14 after the drill caught and corrected version skew.
- Rate-limit suites passed 33 assertions. Application health, container health,
  logs, and PostgreSQL readiness were clean. Recovery drills are documented with
  an explicit production-approval boundary.
- Authenticated Chromium passed defaults, developer tokens, v1 API, client
  redaction, SDK lifecycle, desktop/mobile layouts, and produced zero console or
  unexpected request failures. Visual review found no new UI issue.
- A read-only production inventory on 2026-08-08 found the healthy live container
  running the retained immutable image
  `markup-clone:d47ada5bfa0d66be70d4751ce63ddfee07c63da3` with matching local
  image ID
  `sha256:c077ad33288c5284c16d6c58d11f1bb140dd14167c24502bab0ce81cdc55d891`.
  The public health endpoint returned HTTP 200. The deploy now fails closed
  before migrations if the current tag is mutable, missing, invalid, or no longer
  resolves to the running image, and atomically records the verified rollback
  tag/ID. It also refuses tracked or untracked source changes so an uncommitted
  build cannot be mislabeled with the prior commit SHA. Production rollback
  execution remains explicitly approval-gated.
- Final-tree verification passed 881 tests with 3 intentional skips,
  warning-free ESLint, Bash syntax checks, the host production build, and the
  exact Linux production image build. A final read-only production check again
  matched the running image ID to the retained tag and returned healthy/HTTP 200.
- The subsequent managed-share and notification slices add migrations 25 and 26.
  The final release tree reapplied all 26 migrations from zero and passed 875 tests
  with 3 skipped, Prisma
  validation, ESLint, the warning-free production build, a zero-vulnerability
  production dependency audit, and the managed-share browser lifecycle. The
  rollback execution and the production decision remain the retained release
  boundaries.
- The subsequent loopback-only ingestion rehearsal accepted 24/24 real multipart
  pin requests at concurrency 6 with 157ms p95 and verified removal of all fixture
  project/screenshot rows and files. This is local single-container evidence only.
- The release-tree audit excludes Playwright output from Git and Docker contexts,
  enforces LF endings for shell scripts, and found no credential-pattern matches
  in the changed release files. All 48 API route files were inventoried; the only
  routes without an application-data guard are the intentional logout, health,
  and public OpenAPI handlers.
- Migration application is now fail-fast and atomic. Contract tests first proved
  the prior deploy path could hide a SQL error and still record a migration; the
  replacement uses `ON_ERROR_STOP` and commits the SQL plus history marker in one
  transaction. A disposable PostgreSQL probe independently proved both the failed
  SQL rollback/no-marker path and the successful schema-plus-marker commit path.
  A second empty-database rehearsal bootstrapped Prisma's compatible history table,
  applied all 26 migrations through the helper, verified 26 finished records, and
  removed the disposable database.
- Release provenance is Git-only: an authenticated fast-forward pull, valid commit,
  and clean tracked/untracked checkout are mandatory. Tarballs and legacy marker
  fallback cannot label arbitrary contents with an old SHA.
- Read-only production inspection confirmed Git remote authentication works. It
  also found content-identical mode-only drift on `scripts/prune-screenshots.sh`
  (`0755` on the host versus committed `0644`). The clean-tree guard correctly
  blocks deployment until Cameron approves either committing the intended mode or
  restoring the host mode. Production remains unchanged.
- Current final-tree gates pass 896 tests with 3 intentional skips, warning-free
  ESLint, Prisma validation, a zero-vulnerability production dependency audit,
  the host production build, and the exact Linux image build. The built image ran
  as an isolated local container, returned healthy, matched its image ID, and was
  removed after the probe.
- A final edge audit corrected the old Caddy assumption: Traefik owns public
  80/443 and the system Caddy unit is masked. Deployment now detects the edge,
  never kills container-owned Caddy processes in Traefik mode, verifies trusted
  public HTTPS before migrations and after startup, and prevents cron from
  changing tracked script modes. The exact read-only production preflight fails
  closed because Traefik currently serves an explicitly loaded self-signed Markup
  certificate and its ACME store has no Markup certificate. Live certificate
  repair/reload remains approval-gated.
- Read-only recovery inspection found a matching mode-0600 Let's Encrypt archive
  for the exact Markup hostname, valid through 2026-09-13. The repair runbook now
  restores that pair first for an immediate trusted rollback, then removes only
  the Markup static binding so the already-enabled runtime router can populate the
  active ACME store. The strengthened edge helper validates Traefik's loaded
  router, resolver, entrypoint, service, loopback target, trusted certificate, and
  public health payload; against production it passes runtime validation and
  stops only on the current self-signed certificate.
