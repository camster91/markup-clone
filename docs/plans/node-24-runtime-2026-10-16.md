# Node 24 runtime upgrade (2026-10-16)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** 2026-10-15 repo review — the image ran `node:20-alpine`, a floating
tag on a release line that reached end of life in April 2026.

## Decision

Move the image, CI and local tooling to **Node 24**, the current LTS line
(maintained until April 2028). Node 26 is not LTS until late October 2026, so
it is not a production target yet.

The base image is pinned by multi-arch index digest
(`node:24-alpine@sha256:…`) so a rebuild cannot silently change the runtime.
Dependabot's `docker` ecosystem now proposes digest bumps weekly.

## Changes

- `Dockerfile`: `FROM node:24-alpine@sha256:<digest>` (Node 24.22.0, Alpine
  3.24).
- `.github/workflows/ci.yml`, `lint.yml`: `node-version: '24'`.
- `.nvmrc` (`24`) and `package.json` `engines.node` (`>=24`) so local and CI
  runs match production. `@types/node` follows to `^24`.
- `.github/dependabot.yml`: add the `docker` ecosystem.
- README requirement line.
- `.github/workflows/build-and-push.yml`: default platform `linux/amd64`. On
  Node 24 the QEMU-emulated arm64 leg hung in `npm ci` until the 30-minute
  job limit (the amd64 leg finished in ~2 minutes), and on Node 20 the same leg
  already failed intermittently (`ECONNRESET` in #84's run). Nothing pulls the
  GHCR images — `deploy.sh` and the Coolify config build on the host — so
  arm64 is opt-in via the `platforms` input, ideally on a native arm64 runner.

## Verification

- Full image build for `linux/amd64` with the new base, including the in-image
  PDF renderer contract check (`verify-pdf-renderer-image.mjs`).
- In the built image: `node -v`, Chromium headless screenshot, `psql --version`
  (must stay 16 to match the `postgres:16` server), `pdftoppm`.
- Boot the image against a disposable Postgres with all migrations applied and
  hit `/api/health`.
- Unit/integration suite, lint, typecheck and `next build` under Node 24.

## Out of scope

Running the container as a non-root user. Existing files under the
`/data/screenshots` bind mount on the VPS (which also holds comment
attachments since `attachment-storage-2026-10-18.md`) are owned by root, so a
`USER` change needs a host-side ownership migration first; it gets its own
plan.

## Deploy

No `deploy.sh` change is needed: it builds from this Dockerfile. The next
approved deploy picks up Node 24. Roll back by redeploying the previous image
(the retained rollback image still runs Node 20).
