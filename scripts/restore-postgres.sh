#!/usr/bin/env bash
# Guarded restore of a backup produced by backup-postgres.sh.
# The caller must name the target database and explicitly permit replacing an
# existing schema. Stop the application before a real production restore.

set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_CONFIRM_DATABASE:?RESTORE_CONFIRM_DATABASE is required}"
source "$(dirname -- "$0")/lib-postgres-env.sh"
BACKUP_PATH="${1:-}"
if [ -z "$BACKUP_PATH" ] || [ ! -f "$BACKUP_PATH" ]; then
  echo "Usage: restore-postgres.sh /absolute/path/to/backup.dump" >&2
  exit 2
fi
case "$BACKUP_PATH" in
  /*) ;;
  *) echo "Backup path must be absolute" >&2; exit 2 ;;
esac
if [ ! -f "$BACKUP_PATH.sha256" ]; then
  echo "Missing checksum: $BACKUP_PATH.sha256" >&2
  exit 2
fi

BACKUP_DIR=$(dirname -- "$BACKUP_PATH")
BACKUP_NAME=$(basename -- "$BACKUP_PATH")
(
  cd -- "$BACKUP_DIR"
  sha256sum -c "$BACKUP_NAME.sha256"
)
pg_restore --list "$BACKUP_PATH" >/dev/null

load_postgres_env
ACTUAL_DATABASE=$(psql --no-psqlrc -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')
if [ "$RESTORE_CONFIRM_DATABASE" != "$ACTUAL_DATABASE" ]; then
  echo "Database confirmation does not match the connected database" >&2
  exit 3
fi

OBJECT_COUNT=$(psql --no-psqlrc -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S');")
if [ "$OBJECT_COUNT" != "0" ] && [ "${ALLOW_NONEMPTY_RESTORE:-0}" != "1" ]; then
  echo "Target database is not empty; set ALLOW_NONEMPTY_RESTORE=1 after stopping writers" >&2
  exit 4
fi

# Produce SQL locally and feed it to psql so DATABASE_URL stays in libpq's
# environment rather than appearing in a pg_restore process argument.
pg_restore --clean --if-exists --no-owner --no-acl --file=- "$BACKUP_PATH" \
  | psql --no-psqlrc -v ON_ERROR_STOP=1
printf 'Restore completed for database %s\n' "$ACTUAL_DATABASE"
