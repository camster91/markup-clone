# Nightly backups of the database and user files (2026-10-18)

**Status:** implemented on branch `ccr-ff82cc8e-enzsdu`; not yet deployed.
**Source:** follow-up to `attachment-storage-2026-10-18.md`.

## Gap

- Nothing backed up user files. Screenshots, uploaded images, PDF pages and
  comment attachments under `/data/screenshots` had no copy anywhere, so a bad
  delete or prune (like the one fixed in #78) was permanent.
- Nothing scheduled the database backup either. `backup-postgres.sh` existed
  but only ran when an operator ran it by hand.

## Change

- `scripts/backup-files.sh` — tars every regular file under `SCREENSHOTS_DIR`
  into `/data/backups/markup-files-<stamp>.tar` with a `.sha256` sidecar.
  - Skips in-flight writes (`*.tmp.*`, `.pdf-*`, `.restore-*`).
  - Checks the archive's member count against the listing.
  - Refuses to run when free space is below the data size plus 10%.
  - No compression: the files are already PNG, JPEG or WebM.
  - If `ATTACHMENTS_DIR` points outside `SCREENSHOTS_DIR` (a supported
    override), it gets its own `markup-attachments-<stamp>.tar`, restored back
    into `ATTACHMENTS_DIR`.
- `scripts/restore-files.sh` — guarded restore.
  - Needs `RESTORE_CONFIRM_DIR` and a valid checksum.
  - Extracts to a staging directory and only adds files that are missing.
  - Never overwrites or deletes, so it is safe while the app runs.
- `scripts/nightly-backup.sh` — runs the database and file backups.
  - Then keeps the newest `BACKUP_KEEP_DB` dumps (14) and `BACKUP_KEEP_FILES`
    archives (3).
  - Retention runs only after both backups succeed.
- `scripts/install-cron.sh` — `/etc/cron.d/markup-backup` runs it at 02:15 UTC
  through `docker exec markup-clone`, before the 03:00 prune.
  - `install-cron.sh` already runs after every healthy deploy; `deploy.sh` is
    unchanged.

## Consistency

The app keeps running during the backup, so the dump and the archive are
taken moments apart. The dump runs first. Every file a dumped row points to is
therefore still on disk when the archive is made, unless that row was deleted
in between, which means the user had just deleted it. Files created after the
dump are extra orphans that the prune removes. A fully consistent pair would
need the app stopped or a filesystem snapshot; not worth it for a few seconds
at 02:15.

## Not covered

Off-host copies. The backups sit on the same disk as the data, so they cover
mistakes, not a lost disk or server. Shipping them off the host needs a
destination (object storage, another server) chosen by the operator.

## Verification

- `tests/unit/file-backup-scripts.test.ts` runs the real scripts:
  - archive contents and checksum;
  - temp-file and work-dir exclusion;
  - the disk-space guard;
  - restore adds missing files only;
  - checksum and unsafe-path refusal;
  - retention, and no deletion after a failed backup;
  - the cron line.
- End to end in the built app image (BusyBox tar, `postgresql16-client`)
  against a disposable Postgres 16:
  - nightly run, retention, restore of deleted files without overwriting a
    changed one, and `pg_restore --list` of the dump;
  - archives whose paths start with `/`, `../` or `a/../../` all stayed inside
    the target.

## Disk use

A file archive is about the size of `/data/screenshots`, so retention holds
about four copies at peak (three kept plus the new one). Check
`du -sh /data/screenshots` and `df -h /data` on the host before the first
deploy that installs the cron. If space is tight, set `BACKUP_KEEP_FILES=1`
in `/root/markup-clone/.env`.
