# Release checklist — P0 deploy before 2026-11-06 (2026-10-21)

**Goal:** ship everything merged since the production release
`81836384` (deployed 2026-09-01), before the nightly prune can erase
feedback on 2026-11-06.
**Approval:** production execution requires Cameron's explicit approval.
Tick each box in order. Any failed step is a release stop: fix it and start
that step again. Never skip it.

## What ships

All merged to `main`, none deployed yet:

| PR | Change | Deploy-time step |
|----|--------|------------------|
| #78–#83 | P0: prune keeps feedback; cross-team access fixes | Post-deploy prune dry run (step 6) |
| #65 | Security residuals | None |
| #86 | Node 24 runtime | None |
| #88 | Comment attachments on the mounted volume | **Rescue copy right before deploy** (step 3) |
| #89 | Nightly DB and file backups | Disk check (step 1); cron check (step 5) |
| #90 | Non-root app container | First start sets `/data/screenshots` to uid 1000 |
| #91 | Attachment claim race, stale row pruning | None |
| #94 | DNS-rebinding guard for webhooks | None |
| #95 | Unscoped project access matches the list | None |
| #96 | Prisma 7 (pg driver adapter); shipped with P0 by owner decision on 2026-10-21 | None; no schema change |
| #97 | Safer `deploy.sh` | Takes effect from the *next* deploy (see below) |

- **No new migrations** since `81836384`. The only migration step is the
  `_prisma_migrations` check.
- **The `docker run` mounts are unchanged.**
- **One deploy is enough.** `deploy.sh` pulls first, but bash keeps running
  the copy it started with, so this deploy runs the old script. That is safe
  here: there are no migrations to run before the build, and the mounts are
  the same. From the next deploy on, the new script runs.

## 1. Preflight (read-only, the day of the release)

- [ ] Run the runbook's **Pre-deploy checklist**, items 1–11, in
      `docs/DEPLOY-RUNBOOK.md`. Item 5 is run locally on the release commit.
- [ ] **TLS expiry:** the edge preflight (item 2) prints the certificate's
      expiry date. The certificate on record expires **2026-11-06**, the same
      day as the deadline. If it hasn't renewed, the deploy's public check
      fails closed, so fix TLS first.
- [ ] **Backup disk space:** compare the two numbers below. Each kept file
      archive is about the size of `/data/screenshots`, and retention holds
      about four. If space is tight, add `BACKUP_KEEP_FILES=1` to `.env`.

  ```bash
  ssh coolify 'du -sh /data/screenshots; df -h /data'
  ```

## 2. Back up and keep the rollback image

- [ ] Take a fresh database backup and check it. Copy both files off-host.

  ```bash
  ssh coolify 'docker exec markup-clone bash /opt/app-scripts/backup-postgres.sh'
  ssh coolify 'ls -l /data/markup-clone/backups | tail -3'
  ```

- [ ] Keep the current image safe from the nightly image prune:

  ```bash
  ssh coolify 'bash /root/markup-clone/scripts/retain-rollback-image.sh'
  ```

## 3. Rescue comment attachments (immediately before step 4)

Attachments uploaded since the last deploy live only inside the running
container, and the deploy deletes that container.

- [ ] Copy them to the volume and note the count:

  ```bash
  ssh coolify 'mkdir -p /data/screenshots/attachments && docker cp markup-clone:/data/attachments/. /data/screenshots/attachments/ && ls /data/screenshots/attachments | wc -l'
  ```

  An error saying `/data/attachments` does not exist means there's nothing to
  rescue. Deploy straight after this step: uploads made in between are not
  copied.

## 4. Deploy

- [ ] Run the deploy:

  ```bash
  ssh coolify 'bash /root/markup-clone/scripts/deploy.sh'
  ```

- [ ] It ends with `DEPLOY OK: <sha>`, and `<sha>` matches `main`.

## 5. Verify

- [ ] Local health: `ssh coolify 'curl -fsS http://127.0.0.1:3030/api/health'`
- [ ] Public release: run `npm run verify:public-release` locally, from the
      exact release commit.
- [ ] The container runs as the non-root user. Expect `1000`:
      `ssh coolify 'docker exec markup-clone id -u'`
- [ ] Rescued attachments are visible. Expect the count from step 3:
      `ssh coolify 'docker exec markup-clone ls /data/screenshots/attachments | wc -l'`
- [ ] The backup cron is installed: `ssh coolify 'cat /etc/cron.d/markup-backup'`
- [ ] Clean logs: `ssh coolify 'docker logs --since 10m markup-clone 2>&1 | tail -50'`
- [ ] Smoke test: sign in, open a project, and check that existing pins and
      comments render and that a reply posts. This is a production write, so
      get approval at the time.

## 6. P0 confirmation

- [ ] Prune dry run. Confirm that no pinned, uploaded or PDF screenshot is
      listed:

  ```bash
  ssh coolify 'DRY_RUN=1 SCREENSHOT_DIR=/data/screenshots bash /root/markup-clone/scripts/prune-screenshots.sh'
  ```

## 7. Remove the legacy trust line

- [ ] Follow `docs/DEPLOY-RUNBOOK.md` §"Remove the legacy `pg_hba` trust
      line (one-time)". It's safe right after this deploy, because every later
      deploy runs the new script.

## 8. Record

- [ ] In `TASK.md`, mark each item above as deployed with the deployed SHA.
      Note the backup file name and the dry-run result under P0.

## Rollback

Use the runbook's **Rollback drill** with the retained image. Before rolling
back:

- Add `ATTACHMENTS_DIR=/data/screenshots/attachments` to
  `/root/markup-clone/.env`. Without it, the old image looks for attachments
  in its own container and doesn't see the rescued files.
- No database step is needed. This release adds no migrations, and Prisma 7
  changes no schema.
- The old image runs as root and can still read the uid-1000 files.
