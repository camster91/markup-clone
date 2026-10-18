#!/usr/bin/env bash
# Guarded restore of an archive made by backup-files.sh.
# It only adds files that are missing from SCREENSHOTS_DIR. It never
# overwrites or deletes a file that is already there, so it can run while the
# app is serving. Restore the matching database dump first; files with no
# database row are removed by the nightly prune after 90 days.
#   docker exec -e RESTORE_CONFIRM_DIR=/data/screenshots markup-clone \
#     bash /opt/app-scripts/restore-files.sh /data/backups/markup-files-<stamp>.tar

set -euo pipefail
umask 022

SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/data/screenshots}"
: "${RESTORE_CONFIRM_DIR:?RESTORE_CONFIRM_DIR is required; set it to the target SCREENSHOTS_DIR}"
BACKUP_PATH="${1:-}"
if [ -z "$BACKUP_PATH" ] || [ ! -f "$BACKUP_PATH" ]; then
  echo "Usage: restore-files.sh /absolute/path/to/markup-files-<stamp>.tar" >&2
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
if [ ! -d "$SCREENSHOTS_DIR" ]; then
  echo "SCREENSHOTS_DIR does not exist: $SCREENSHOTS_DIR" >&2
  exit 2
fi
if [ "$RESTORE_CONFIRM_DIR" != "$SCREENSHOTS_DIR" ]; then
  echo "Directory confirmation does not match SCREENSHOTS_DIR" >&2
  exit 3
fi

(
  cd -- "$(dirname -- "$BACKUP_PATH")"
  sha256sum -c "$(basename -- "$BACKUP_PATH").sha256"
)

# backup-files.sh writes relative names only. Refuse anything that could land
# outside the target. GNU tar lists such names verbatim, so this catches them;
# BusyBox tar (the app image) already strips leading '/' and '../' parts from
# both the listing and the extraction. Either way extraction goes to a staging
# directory and only regular files are moved out of it.
if tar -tf "$BACKUP_PATH" | grep -Eq '^/|(^|/)\.\.(/|$)'; then
  echo "Archive contains absolute or parent-directory paths; refusing to restore" >&2
  exit 4
fi

# Stage inside the target so the final moves stay on one filesystem.
STAGE=$(mktemp -d "$SCREENSHOTS_DIR/.restore-XXXXXX")
trap 'rm -rf -- "$STAGE"' EXIT
tar -xf "$BACKUP_PATH" -C "$STAGE"

ADDED=0
KEPT=0
while IFS= read -r -d '' file; do
  rel=${file#"$STAGE"/}
  dest="$SCREENSHOTS_DIR/$rel"
  if [ -e "$dest" ]; then
    KEPT=$((KEPT + 1))
    continue
  fi
  mkdir -p -- "$(dirname -- "$dest")"
  mv -- "$file" "$dest"
  ADDED=$((ADDED + 1))
done < <(find "$STAGE" -type f -print0)

printf 'Restored %d missing files into %s; kept %d existing files unchanged\n' \
  "$ADDED" "$SCREENSHOTS_DIR" "$KEPT"
