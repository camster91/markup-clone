#!/usr/bin/env bash
# Nightly recovery point: a database dump plus an archive of every user file,
# then retention. Runs inside the app container; install-cron.sh schedules it:
#   docker exec markup-clone bash /opt/app-scripts/nightly-backup.sh
#
# Retention keeps the newest BACKUP_KEEP_DB dumps (default 14) and the newest
# BACKUP_KEEP_FILES file archives (default 3), manual backups included. It runs
# only after both backups succeed, so a failing night never deletes older
# recovery points.
#
# These copies sit on the same host as the data. They cover mistakes (a bad
# delete, a bad prune), not a lost disk or server: copy the newest pair off
# the host for that.

set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
KEEP_DB="${BACKUP_KEEP_DB:-14}"
KEEP_FILES="${BACKUP_KEEP_FILES:-3}"
SCRIPT_DIR=$(dirname -- "$0")

for keep in "$KEEP_DB" "$KEEP_FILES"; do
  case "$keep" in
    '' | *[!0-9]* | 0) echo "BACKUP_KEEP_DB and BACKUP_KEEP_FILES must be positive integers" >&2; exit 2 ;;
  esac
done

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# Assign before logging: a failed command substitution inside log's arguments
# would not stop the script under set -e.
DB_BACKUP=$(BACKUP_DIR="$BACKUP_DIR" bash "$SCRIPT_DIR/backup-postgres.sh")
log "database backup: $DB_BACKUP"
FILES_BACKUP=$(BACKUP_DIR="$BACKUP_DIR" bash "$SCRIPT_DIR/backup-files.sh")
log "file backup: ${FILES_BACKUP:-skipped (no files)}"

# Delete all but the newest $2 matches of glob $1, with their checksums.
# Timestamped names sort oldest first.
prune_backups() {
  local pattern=$1 keep=$2 files i
  shopt -s nullglob
  # shellcheck disable=SC2206 # the pattern is meant to glob
  files=("$BACKUP_DIR"/$pattern)
  shopt -u nullglob
  for ((i = 0; i < ${#files[@]} - keep; i++)); do
    rm -f -- "${files[i]}" "${files[i]}.sha256"
    log "removed old backup $(basename -- "${files[i]}")"
  done
}
prune_backups 'markup-[0-9]*.dump' "$KEEP_DB"
prune_backups 'markup-files-[0-9]*.tar' "$KEEP_FILES"
