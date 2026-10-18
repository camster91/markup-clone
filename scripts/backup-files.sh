#!/usr/bin/env bash
# Archive every user file into an integrity-checked tar next to the database
# dumps. Screenshots, uploaded images, PDF pages and comment attachments all
# live under SCREENSHOTS_DIR (attachments in its attachments/ subdirectory).
# Run inside the app container, which mounts both directories:
#   docker exec markup-clone bash /opt/app-scripts/backup-files.sh
# The files are already compressed (PNG, JPEG, WebM), so the tar is not.

set -euo pipefail
umask 077

SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/data/screenshots}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"

for dir in "$SCREENSHOTS_DIR" "$BACKUP_DIR"; do
  case "$dir" in
    /*) ;;
    *) echo "SCREENSHOTS_DIR and BACKUP_DIR must be absolute paths" >&2; exit 2 ;;
  esac
  if [ "$dir" = "/" ]; then
    echo "Refusing to use the filesystem root" >&2
    exit 2
  fi
done
if [ ! -d "$SCREENSHOTS_DIR" ]; then
  echo "SCREENSHOTS_DIR does not exist: $SCREENSHOTS_DIR" >&2
  exit 2
fi
case "$BACKUP_DIR/" in
  "$SCREENSHOTS_DIR"/*)
    echo "BACKUP_DIR must not be inside SCREENSHOTS_DIR" >&2
    exit 2
    ;;
esac

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_PATH="$BACKUP_DIR/markup-files-$STAMP.tar"
TEMP_PATH="$BACKUP_PATH.tmp.$$"
LIST_PATH="$BACKUP_PATH.list.$$"
trap 'rm -f -- "$TEMP_PATH" "$LIST_PATH"' EXIT

# Regular files only, relative to SCREENSHOTS_DIR. Skip in-flight writes: pin
# captures staged as <id>.tmp.<rand>, PDF render work dirs (.pdf-<id>) and
# restore staging dirs (.restore-*).
(
  cd -- "$SCREENSHOTS_DIR"
  find . -type f ! -name '*.tmp.*' ! -path './.pdf-*' ! -path './.restore-*' | sort
) > "$LIST_PATH"
FILE_COUNT=$(wc -l < "$LIST_PATH")
if [ "$FILE_COUNT" -eq 0 ]; then
  echo "No files under $SCREENSHOTS_DIR; nothing to back up" >&2
  exit 0
fi

# The archive is about the size of the files. Keep 10% headroom so a backup
# can never fill the disk the app writes to.
NEED_KB=$(du -sk -- "$SCREENSHOTS_DIR" | cut -f1)
FREE_KB=$(df -Pk -- "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if [ $((NEED_KB + NEED_KB / 10)) -gt "$FREE_KB" ]; then
  echo "Not enough free space in $BACKUP_DIR: need about ${NEED_KB}KB plus 10%, have ${FREE_KB}KB" >&2
  exit 5
fi

# A file deleted between the listing and the archive (a pin or project
# delete) makes tar fail; the run then fails loudly and the next one retries.
tar -cf "$TEMP_PATH" -C "$SCREENSHOTS_DIR" -T "$LIST_PATH"
ARCHIVED=$(tar -tf "$TEMP_PATH" | wc -l)
if [ "$ARCHIVED" -ne "$FILE_COUNT" ]; then
  echo "Archive holds $ARCHIVED files, expected $FILE_COUNT" >&2
  exit 6
fi
mv -- "$TEMP_PATH" "$BACKUP_PATH"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$(basename -- "$BACKUP_PATH")" > "$(basename -- "$BACKUP_PATH").sha256"
)
chmod 600 -- "$BACKUP_PATH" "$BACKUP_PATH.sha256"
printf '%s\n' "$BACKUP_PATH"
