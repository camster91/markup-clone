#!/usr/bin/env bash
# Server-side recapture of a screenshot for an existing Screenshot row.
# Usage:
#   bash scripts/recapture.sh <screenshotId>
#   bash scripts/recapture.sh <screenshotId> <width> <height>   (optional, defaults to 1280x800)
#
# What it does:
#   1. Look up the Screenshot row in the DB to find the parent Page
#   2. Look up the Page -> Project to find the project's domain
#   3. Build the URL: https://<project.domain><page.path>
#   4. Run Chromium headless to screenshot that URL
#   5. Replace the existing PNG at /data/screenshots/<screenshotId>.png
#   6. Update the Screenshot row's width/height in the DB
#
# Requires: chromium (or chromium-browser) on PATH, postgres client (psql),
#           access to the markup-postgres container via docker exec,
#           write access to /data/screenshots/

set -euo pipefail

SCREENSHOT_ID="${1:-}"
WIDTH="${2:-1280}"
HEIGHT="${3:-800}"

if [ -z "$SCREENSHOT_ID" ]; then
  echo "Usage: $0 <screenshotId> [width] [height]" >&2
  exit 1
fi

# Find the right binaries (chromium, chromium-browser, or google-chrome)
CHROME=""
for c in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$c" >/dev/null 2>&1; then
    CHROME="$c"
    break
  fi
done
if [ -z "$CHROME" ]; then
  echo "No chromium binary found on PATH" >&2
  exit 2
fi

# Pick the DB client: psql (if installed) or docker exec into the postgres container.
# The container has psql; the host fallback uses docker exec.
if command -v psql >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  PSQL="psql"
elif command -v docker >/dev/null 2>&1; then
  PSQL="docker exec ${PG_CONTAINER:-markup-postgres} psql"
else
  echo "No psql and no docker; cannot update DB" >&2
  exit 5
fi

SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/data/screenshots}"
PG_CONTAINER="${PG_CONTAINER:-markup-postgres}"
OUT_FILE="$SCREENSHOTS_DIR/$SCREENSHOT_ID.png"

# Look up the project domain + page path
read -r DOMAIN PATH_ < <($PSQL -U markup -d markup_db -t -A -F'|' \
  -c "SELECT p.domain, pa.path FROM \"Screenshot\" s JOIN \"Page\" pa ON pa.id = s.\"pageId\" JOIN \"Project\" p ON p.id = pa.\"projectId\" WHERE s.id = '$SCREENSHOT_ID'")

if [ -z "$DOMAIN" ]; then
  echo "Screenshot $SCREENSHOT_ID not found" >&2
  exit 3
fi

URL="https://${DOMAIN}${PATH_}"
echo "Re-capturing ${URL} (${WIDTH}x${HEIGHT}) → ${OUT_FILE}"

# Capture. --hide-scrollbars + --virtual-time-budget so we wait for fonts.
"$CHROME" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size="${WIDTH},${HEIGHT}" \
  --virtual-time-budget=5000 \
  --screenshot="$OUT_FILE" \
  "$URL" 2>/dev/null

if [ ! -s "$OUT_FILE" ]; then
  echo "Capture failed: $OUT_FILE is empty or missing" >&2
  exit 4
fi

# Update dimensions in the DB
W=$(python3 -c "
import struct
with open('$OUT_FILE', 'rb') as f:
    f.seek(16)
    print(struct.unpack('>I', f.read(4))[0])
")
H=$(python3 -c "
import struct
with open('$OUT_FILE', 'rb') as f:
    f.seek(20)
    print(struct.unpack('>I', f.read(4))[0])
")

$PSQL -U markup -d markup_db -c \
  "UPDATE \"Screenshot\" SET width = $W, height = $H WHERE id = '$SCREENSHOT_ID'" >/dev/null

echo "OK: $OUT_FILE (${W}x${H})"
