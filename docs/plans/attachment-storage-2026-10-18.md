# Comment attachments lost on every deploy (2026-10-18)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** found while checking bind mounts for the non-root container
follow-up of `node-24-runtime-2026-10-16.md`.

## Defect

Comment attachments (pasted images, voice notes, screen recordings) were
written to `ATTACHMENTS_DIR`, default `/data/attachments`. No deploy setup
mounts that path:

- `scripts/deploy.sh` mounts `/data/screenshots`, `/data/backups` and the
  scripts directory only;
- `docker-compose.yml` mounts the `screenshots` and `backups` volumes only;
- the Coolify config (draft PR #69) binds the same two paths.

So attachments lived in the app container's writable layer. `deploy.sh`
runs `docker rm -f markup-clone` before starting the new container, which
deletes every attachment uploaded since the previous deploy. The
`Attachment` rows survive, so old comments show broken media. The Postgres
backup scripts do not cover any user files.

## Change

- New `src/lib/storage-dirs.ts`: `screenshotsDir()` and `attachmentsDir()`.
  Attachments default to `<SCREENSHOTS_DIR>/attachments`, inside the one
  volume every setup already mounts. `ATTACHMENTS_DIR` still overrides it.
  Values are read at call time.
- `POST /api/attachments`, `GET /api/attachments/[id]` and the project
  `DELETE` use the helper.
- No `deploy.sh`, Compose or Coolify change is needed.
- The prune cron only scans the top level of the screenshots directory
  (`find -maxdepth 1 -name '*.png'`), so it never sees attachments; a test
  pins that.

## Tests

- `tests/unit/storage-dirs.test.ts` — defaults, overrides, and that the
  default sits inside the volume `deploy.sh` and Compose mount.
- `tests/integration/attachment-ownership.test.ts` — upload writes under
  `/data/screenshots/attachments/`.
- `tests/integration/project-delete-files.test.ts` — project delete removes
  attachments from the new default and from an `ATTACHMENTS_DIR` override.
- `tests/unit/prune-screenshots-retention.test.ts` — prune leaves old
  `.png` files in `attachments/` alone.

## Deploy — rescue existing files first

Attachments uploaded since the last deploy exist only inside the running
`markup-clone` container. `deploy.sh` deletes that container, so copy them
onto the volume **before** deploying:

```bash
ssh coolify 'mkdir -p /data/screenshots/attachments && docker cp markup-clone:/data/attachments/. /data/screenshots/attachments/ && ls /data/screenshots/attachments | wc -l'
```

An error saying `/data/attachments` does not exist means nobody has
uploaded an attachment since the last deploy; nothing to rescue. Then
deploy as usual. Uploads made between the copy and the container swap are
not rescued; deploy right after the copy.

Attachments uploaded before the previous deploy are already gone; their
rows remain and render as missing media.

### Rollback

The retained rollback image still defaults to `/data/attachments`. Before
rolling back, add `ATTACHMENTS_DIR=/data/screenshots/attachments` to
`/root/markup-clone/.env` so the old code reads and writes the same mounted
directory.
