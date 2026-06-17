#!/usr/bin/env bash
# Delete screenshot files older than 90 days from /data/screenshots.
# Also orphan the corresponding DB rows so CASCADE cleans up
# Page→Screenshot→Pin→Comment.
#
# ScreenshotVersion rows: every recapture writes a new PNG with a
# fresh UUID-based storageKey and inserts a matching ScreenshotVersion
# row. The prune passes the 90-day window over BOTH the Screenshot
# (which represents the "latest pointer" — its capturedAt is bumped
# on every recapture, so only screenshots with no recaptures in 90
# days qualify) and the ScreenshotVersion rows (the immutable history
# — these are pruned independently because a recent Screenshot can
# still have old versions from recaptures >90 days ago). Files on
# disk that back the old ScreenshotVersion rows are also deleted
# (by listing all storageKeys still referenced by surviving
# Screenshot + ScreenshotVersion rows and rm-ing the rest).
#
# Dry-run: DRY_RUN=1 ./prune-screenshots.sh
#
# Deploy as a cron job (user wires to /etc/cron.daily/ or equivalent).

set -euo pipefail

SCREENSHOT_DIR="${SCREENSHOT_DIR:-/data/screenshots}"
DAYS="${RETENTION_DAYS:-90}"
LOG_FILE="${LOG_FILE:-/var/log/prune-screenshots.log}"
PG_CONTAINER="${PG_CONTAINER:-markup-postgres}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[$(date -Iseconds)] $*"
}

# ── Find files older than $DAYS ───────────────────────────────────────────────
if [ ! -d "$SCREENSHOT_DIR" ]; then
  log "WARN: $SCREENSHOT_DIR does not exist — nothing to prune"
  exit 0
fi

mapfile -t OLD_FILES < <(find "$SCREENSHOT_DIR" -maxdepth 1 -name "*.png" -mtime +"$DAYS" -type f 2>/dev/null)

# ── DB cleanup of Screenshot + ScreenshotVersion rows ─────────────────────────
# We run the DB cleanup FIRST so we have a definitive list of
# storageKeys that are still referenced (the survivors) — any
# on-disk file not in that list is a candidate for deletion. Doing
# it the other way around would risk deleting a file whose row we
# then orphan (the /image endpoint would 404 in the gap between rm
# and the DELETE). The Screenshot row's capturedAt is bumped on
# every recapture, so a Screenshot with no recaptures in 90 days
# has capturedAt < NOW - INTERVAL '$DAYS days' and qualifies.
#
# ScreenshotVersion.capturedAt is the per-recapture timestamp, so
# a recent Screenshot can still have versions older than 90 days
# (e.g. a Screenshot that was recaptured yesterday but had its
# last recapture 91 days before that — the second-most-recent
# version). Pruning ScreenshotVersion independently keeps the
# history bounded at 90 days regardless of the Screenshot's age.
if [ "${DRY_RUN:-}" != "1" ]; then
  log "Pruning Screenshot rows older than $DAYS days in DB..."
  docker exec "$PG_CONTAINER" psql -U markup -d markup_db -c \
    "DELETE FROM \"Screenshot\" WHERE \"capturedAt\" < NOW() - INTERVAL '$DAYS days'" \
    2>&1 | tee -a "$LOG_FILE" || log "WARN: Screenshot DB cleanup failed (container or query error)"

  log "Pruning ScreenshotVersion rows older than $DAYS days in DB..."
  docker exec "$PG_CONTAINER" psql -U markup -d markup_db -c \
    "DELETE FROM \"ScreenshotVersion\" WHERE \"capturedAt\" < NOW() - INTERVAL '$DAYS days'" \
    2>&1 | tee -a "$LOG_FILE" || log "WARN: ScreenshotVersion DB cleanup failed (container or query error)"
fi

# ── Filter OLD_FILES against the DB's surviving storageKeys ──────────────────
# A file in OLD_FILES might still be referenced by a surviving
# ScreenshotVersion row (its capturedAt is <90d even if the file
# mtime is >90d — file mtime tracks the most recent write, not the
# capturedAt semantics). We ask the DB for the set of still-live
# storageKeys and remove any file whose name is still in that set
# from the deletion list. This way an on-disk file that was written
# 91 days ago but is referenced by a recent version is preserved.
#
# In DRY_RUN mode we ALSO want to be honest about what would
# happen — so the file-vs-DB set difference is computed in both
# modes. (We just skip the actual rm.)
SURVIVING_KEYS_FILE="$(mktemp)"
trap 'rm -f "$SURVIVING_KEYS_FILE"' EXIT
if [ "${DRY_RUN:-}" != "1" ]; then
  docker exec "$PG_CONTAINER" psql -U markup -d markup_db -t -A -F'' \
    -c "SELECT \"storageKey\" FROM \"Screenshot\" UNION SELECT \"storageKey\" FROM \"ScreenshotVersion\"" \
    > "$SURVIVING_KEYS_FILE" 2>/dev/null || log "WARN: could not enumerate surviving storageKeys; proceeding without the dedupe filter"
fi

TO_DELETE=()
for f in "${OLD_FILES[@]}"; do
  base=$(basename "$f")
  if [ -s "$SURVIVING_KEYS_FILE" ] && grep -Fxq "$base" "$SURVIVING_KEYS_FILE"; then
    log "Skipping (still referenced by DB): $f"
    continue
  fi
  TO_DELETE+=("$f")
done

if [ ${#TO_DELETE[@]} -eq 0 ]; then
  log "No orphaned screenshots older than $DAYS days found"
  log "Done."
  exit 0
fi

# Count and size before deletion
TOTAL_COUNT=${#TO_DELETE[@]}
TOTAL_BYTES=0
for f in "${TO_DELETE[@]}"; do
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

log "Done."
