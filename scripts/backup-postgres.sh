#!/usr/bin/env bash
# Create an integrity-checked custom-format PostgreSQL backup.
# Run inside the app container, which supplies pg_dump and DATABASE_URL:
#   docker compose exec app bash /opt/app-scripts/backup-postgres.sh

set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
source "$(dirname -- "$0")/lib-postgres-env.sh"

case "$BACKUP_DIR" in
  /*) ;;
  *) echo "BACKUP_DIR must be an absolute path" >&2; exit 2 ;;
esac
if [ "$BACKUP_DIR" = "/" ]; then
  echo "Refusing to use the filesystem root as BACKUP_DIR" >&2
  exit 2
fi

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_PATH="$BACKUP_DIR/markup-$STAMP.dump"
TEMP_PATH="$BACKUP_PATH.tmp.$$"
trap 'rm -f -- "$TEMP_PATH"' EXIT

# libpq reads the connection string from the process environment, keeping it
# out of argv, logs, and the resulting backup metadata.
load_postgres_env
pg_dump --format=custom --compress=6 --no-owner --no-acl --file="$TEMP_PATH"
test -s "$TEMP_PATH"
pg_restore --list "$TEMP_PATH" >/dev/null
mv -- "$TEMP_PATH" "$BACKUP_PATH"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$(basename -- "$BACKUP_PATH")" > "$(basename -- "$BACKUP_PATH").sha256"
)
chmod 600 -- "$BACKUP_PATH" "$BACKUP_PATH.sha256"
trap - EXIT
printf '%s\n' "$BACKUP_PATH"
