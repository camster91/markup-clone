#!/usr/bin/env bash
# Archive every user file into integrity-checked tars next to the database
# dumps. Screenshots, uploaded images, PDF pages and comment attachments live
# under SCREENSHOTS_DIR (attachments in its attachments/ subdirectory) and go
# to markup-files-<stamp>.tar. When ATTACHMENTS_DIR moves attachments outside
# it (src/lib/storage-dirs.ts), they get their own markup-attachments-<stamp>.tar.
# Run inside the app container, which mounts these directories:
#   docker exec markup-clone bash /opt/app-scripts/backup-files.sh
# Prints one line per archive written. The files are already compressed
# (PNG, JPEG, WebM), so the tars are not.

set -euo pipefail
umask 077

SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/data/screenshots}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"

# Pairs of archive name and source directory.
ROOTS=(files "$SCREENSHOTS_DIR")
case "$ATTACHMENTS_DIR/" in
  / | "$SCREENSHOTS_DIR"/*) ;; # unset, or already inside SCREENSHOTS_DIR
  *) ROOTS+=(attachments "$ATTACHMENTS_DIR") ;;
esac

for dir in "$BACKUP_DIR" "$SCREENSHOTS_DIR" ${ATTACHMENTS_DIR:+"$ATTACHMENTS_DIR"}; do
  case "$dir" in
    /*) ;;
    *) echo "SCREENSHOTS_DIR, ATTACHMENTS_DIR and BACKUP_DIR must be absolute paths" >&2; exit 2 ;;
  esac
  if [ "$dir" = "/" ]; then
    echo "Refusing to use the filesystem root" >&2
    exit 2
  fi
done
NEED_KB=0
for ((i = 0; i < ${#ROOTS[@]}; i += 2)); do
  root=${ROOTS[i + 1]}
  if [ ! -d "$root" ]; then
    echo "Directory to back up does not exist: $root" >&2
    exit 2
  fi
  case "$BACKUP_DIR/" in
    "$root"/*)
      echo "BACKUP_DIR must not be inside $root" >&2
      exit 2
      ;;
  esac
  NEED_KB=$((NEED_KB + $(du -sk -- "$root" | cut -f1)))
done

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"

# The archives are about the size of the files. Keep 10% headroom so a backup
# can never fill the disk the app writes to.
FREE_KB=$(df -Pk -- "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if [ $((NEED_KB + NEED_KB / 10)) -gt "$FREE_KB" ]; then
  echo "Not enough free space in $BACKUP_DIR: need about ${NEED_KB}KB plus 10%, have ${FREE_KB}KB" >&2
  exit 5
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
CLEANUP=()
trap 'rm -f -- ${CLEANUP[@]+"${CLEANUP[@]}"}' EXIT

archive_root() {
  local name=$1 root=$2
  local backup_path="$BACKUP_DIR/markup-$name-$STAMP.tar"
  local temp_path="$backup_path.tmp.$$" list_path="$backup_path.list.$$"
  local file_count archived
  CLEANUP+=("$temp_path" "$list_path")

  # Regular files only, relative to the root. Skip in-flight writes: pin
  # captures staged as <id>.tmp.<rand>, PDF render work dirs (.pdf-<id>) and
  # restore staging dirs (.restore-*).
  (
    cd -- "$root"
    find . -type f ! -name '*.tmp.*' ! -path './.pdf-*' ! -path './.restore-*' | sort
  ) > "$list_path"
  file_count=$(wc -l < "$list_path")
  if [ "$file_count" -eq 0 ]; then
    echo "No files under $root; nothing to back up" >&2
    return 0
  fi

  # A file deleted between the listing and the archive (a pin or project
  # delete) makes tar fail; the run then fails loudly and the next one retries.
  tar -cf "$temp_path" -C "$root" -T "$list_path"
  archived=$(tar -tf "$temp_path" | wc -l)
  if [ "$archived" -ne "$file_count" ]; then
    echo "Archive of $root holds $archived files, expected $file_count" >&2
    exit 6
  fi
  mv -- "$temp_path" "$backup_path"
  (
    cd -- "$BACKUP_DIR"
    sha256sum "$(basename -- "$backup_path")" > "$(basename -- "$backup_path").sha256"
  )
  chmod 600 -- "$backup_path" "$backup_path.sha256"
  printf '%s\n' "$backup_path"
}

for ((i = 0; i < ${#ROOTS[@]}; i += 2)); do
  archive_root "${ROOTS[i]}" "${ROOTS[i + 1]}"
done
