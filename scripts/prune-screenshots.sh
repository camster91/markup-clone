#!/usr/bin/env bash
# Delete screenshot files older than 90 days from /data/screenshots.
# Also orphan the corresponding DB rows so CASCADE cleans up Page→Screenshot→Pin→Comment.
# Dry-run: DRY_RUN=1 ./prune-screenshots.sh
#
# Deploy as a cron job (user wires to /etc/cron.daily/ or equivalent).

set -euo pipefail

SCREENSHOT_DIR="${SCREENSHOT_DIR:-/data/screenshots}"
DAYS="${RETENTION_DAYS:-90}"
LOG_FILE="${LOG_FILE:-/var/log/prune-screenshots.log}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[$(date -Iseconds)] $*"
}

# ── Find files older than $DAYS ───────────────────────────────────────────────
if [ ! -d "$SCREENSHOT_DIR" ]; then
  log "WARN: $SCREENSHOT_DIR does not exist — nothing to prune"
  exit 0
fi

mapfile -t OLD_FILES < <(find "$SCREENSHOT_DIR" -maxdepth 1 -name "*.png" -mtime +"$DAYS" -type f 2>/dev/null)

if [ ${#OLD_FILES[@]} -eq 0 ]; then
  log "No screenshots older than $DAYS days found"
  exit 0
fi

# Count and size before deletion
TOTAL_COUNT=${#OLD_FILES[@]}
TOTAL_BYTES=0
for f in "${OLD_FILES[@]}"; do
  if [ -f "$f" ]; then
    TOTAL_BYTES=$((TOTAL_BYTES + $(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null || echo 0)))
    if [ "${DRY_RUN:-}" != "1" ]; then
      rm -f "$f"
      log "Deleted: $f"
    else
      log "Would delete: $f"
    fi
  fi
done

if [ "${DRY_RUN:-}" = "1" ]; then
  log "DRY RUN — would delete $TOTAL_COUNT files, freeing approx $TOTAL_BYTES bytes"
else
  log "Deleted $TOTAL_COUNT files, freed approx $TOTAL_BYTES bytes"
fi

# ── Orphan DB rows ─────────────────────────────────────────────────────────────
# Screenshot has no CASCADE to file removal, so we clean the DB after the files.
# The CASCADE chain: Screenshot → Pin → Comment (and Page has CASCADE to Screenshot).
if [ "${DRY_RUN:-}" != "1" ]; then
  log "Orphaning Screenshot rows older than $DAYS days in DB..."
  docker exec markup-postgres psql -U markup -d markup_db -c \
    "DELETE FROM \"Screenshot\" WHERE \"capturedAt\" < NOW() - INTERVAL '$DAYS days'" \\
    2>&1 | tee -a "$LOG_FILE" || log "WARN: DB cleanup failed (container or query error)"
fi

log "Done."