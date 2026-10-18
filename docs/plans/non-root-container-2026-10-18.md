# Run the app container as a non-root user (2026-10-18)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** follow-up in `node-24-runtime-2026-10-16.md`.

## Problem

The app ran as root inside its container. A bug in the app, Next.js or
Chromium (which runs with `--no-sandbox` for recapture) would then have root
inside the container, and full write access to everything mounted into it.

A plain `USER node` line was not safe on its own:

- Every file already in `/data/screenshots` on the VPS was written by root,
  so a `node` process could not delete them or write into `attachments/`.
- The nightly backup and the integration delivery cron run through
  `docker exec`, and expect root.

## Change

- `scripts/docker-entrypoint.sh` (baked into the image) starts as root:
  - it gives `SCREENSHOTS_DIR`, and `ATTACHMENTS_DIR` if set, to `node`;
  - it changes only entries that are wrong, so restarts stay fast;
  - then `su-exec node` runs the app.
- `Dockerfile`:
  - adds `su-exec`;
  - creates `/data/screenshots` and `/app/.next/cache` owned by `node`
    (Next.js writes its cache there; the rest of `/app` stays read-only to the
    app);
  - runs the entrypoint under `dumb-init`.
- No `USER` line, so `docker exec` jobs still run as root. Backups stay
  root-only (`/data/backups` is not handed to `node`).
- `restore-files.sh` gives restored files back to the target directory's
  owner, so the app can write into restored folders.
- No `deploy.sh`, Compose or Coolify change.

## Host effects

- On the first start, files under `/data/screenshots` on the host change owner
  to uid/gid 1000 (`node` in the image). Host root jobs (the prune cron) are
  unaffected.
- Rollback to an older image still works: it runs as root and can read and
  write uid-1000 files.

## Verification (pending: image build in progress)

- Image built from this Dockerfile (Node 24, Alpine).
- Booted against a disposable Postgres 16, with a pre-filled root-owned
  screenshots volume:
  - the app process runs as `node`;
  - the volume is handed over;
  - `/api/health` passes.
- As `node` in the image:
  - headless Chromium writes a screenshot into the volume;
  - Poppler (`pdftoppm`) renders into the volume.
- `docker exec` still runs as root, and the nightly backup succeeds.
- `tests/unit/container-user.test.ts` pins the wiring.
