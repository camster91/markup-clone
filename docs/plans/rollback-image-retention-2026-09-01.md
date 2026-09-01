# Rollback image retention — 2026-09-01

**Status:** implemented and verified; pull-request review pending
**Parent:** governing roadmap L1
**Production finding:** nightly host pruning removed the previously documented
rollback image before the next release

## Outcome

Keep the exact previously deployed Markup image recoverable across the host's
nightly image-prune job without changing the shared fleet cleanup policy.

## Evidence and problem

Read-only release preflight on 2026-09-01 found that production remained healthy
on exact image `e3f9c4d12986da641b01f758316c84e43013b3d8`, but the documented prior
rollback tag `26d906b512b43d25bea79846139aca9972d0abfc` and image ID were absent.
The private rollback pointer still named that missing artifact.

The host runs this global job nightly:

```text
docker image prune -af --filter "until=24h"
```

[Docker documents](https://docs.docker.com/reference/cli/docker/image/prune/)
that `docker image prune -a` removes images not referenced by any container. A
source-SHA tag alone therefore does not satisfy the repository's retained-rollback
promise. A deliberately stopped, labelled container can keep one exact rollback
image referenced without running code, opening ports, mounting data, or consuming
application resources.

## Scope

1. Add an idempotent helper that validates the running container's immutable
   source-SHA image and image ID using the existing rollback invariants.
2. Create a stopped, network-disabled, restart-disabled retainer container for
   that exact image before the application container is replaced.
3. Replace only a prior retainer carrying the expected ownership label; fail
   closed on a name collision.
4. Verify the new retainer resolves to the same image ID as the running release.
5. Add deterministic shell-shim tests for creation, safe replacement, ownership
   refusal, immutable-tag refusal, and image-ID mismatch.
6. Document the action in the release runbook and checklist.

## Acceptance

- The helper refuses mutable tags, unavailable images, ID mismatches, and an
  unowned retainer name.
- A valid run creates exactly one stopped retainer with no network, no restart
  policy, no mounts, and no published ports.
- The retainer is created and verified before the prior owned retainer is
  removed, so the desired rollback image never loses its container reference.
- Repeating the helper safely rotates the retainer to the currently running
  exact image.
- Focused tests, the full Vitest suite, ESLint, TypeScript, build, and diff check
  pass.
- Production execution remains separately approval-gated. The approved release
  sequence must run the helper before `scripts/deploy.sh`, then verify the
  retainer and rollback pointer after deployment.

## Boundaries

- Do not modify the global fleet prune job from this repository.
- Do not change `scripts/deploy.sh` until its required full non-production host
  dry-run can be performed.
- Do not create, replace, or remove a production retainer without exact release
  approval.
- Keep the incumbent paid SaaS active.

## Verification record

- `scripts/retain-rollback-image.sh` independently verifies the same immutable
  source-SHA tag and image-ID relationship as the existing rollback preflight.
- It creates and verifies the replacement retainer before removing a prior
  owned retainer, refuses an unowned stable-name collision, fails closed
  without deleting a pre-existing temporary-name collision, and exposes no
  network, restart, mount, or published-port configuration.
- Thirteen focused helper/preflight/deploy-contract tests pass.
- The full repository suite passes 964 tests across 140 files. ESLint,
  TypeScript, Prisma validation, the widget/shared-package/Next production
  build, Bash syntax, and diff checking pass.
- Docker is unavailable on the local workstation, so a real-engine rehearsal
  has not been substituted for the repository-required non-production host
  deploy dry-run. This change deliberately leaves `scripts/deploy.sh` untouched;
  production use of the helper remains part of the exact approval window.
