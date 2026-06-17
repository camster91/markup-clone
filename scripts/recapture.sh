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
#   4. Generate a fresh UUID for the new version (each recapture is a
#      new ScreenshotVersion row with its own file on disk — the parent
#      Screenshot's storageKey is updated to point at the new file but
#      the old PNGs are kept at their original paths so the history
#      endpoint can still serve them)
#   5. Run Chromium headless to screenshot that URL, writing to the
#      new UUID-based path under $SCREENSHOTS_DIR
#   6. Update the Screenshot row's storageKey, width, height, and
#      capturedAt in the DB (it stays the "latest pointer")
#
# The recapture route's exit handler reads the updated Screenshot row
# and inserts a matching ScreenshotVersion row — the recapture API
# returns the new dims in the response and the version insert is a
# side effect. Keeping the two writes separate means a version-row
# failure doesn't roll back the actual recapture; the file is on
# disk, the Screenshot is up to date, and the missing version row is
# observable as a gap in the history endpoint.
#
# Requires: chromium (or chromium-browser) on PATH, psql (postgres client)
# OR access to the markup-postgres container via docker exec, write access
# to /data/screenshots, python3 (for PNG-header dimension extraction).

set -euo pipefail

SCREENSHOT_ID="${1:-}"
WIDTH="${2:-1280}"
HEIGHT="${3:-800}"

if [ -z "$SCREENSHOT_ID" ]; then
  echo "Usage: $0 <screenshotId> [width] [height]" >&2
  exit 1
fi

# Defense-in-depth: reject non-UUID inputs before any psql call.
# The recapture route (requireDashboardOrigin) already passes a valid
# UUID (it goes through prisma.screenshot.findUnique which rejects
# non-UUID strings), but a future caller might not. Bail loudly
# instead of interpolating arbitrary text into the SQL below.
if ! [[ "$SCREENSHOT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Invalid SCREENSHOT_ID: not a UUID: $SCREENSHOT_ID" >&2
  exit 6
fi

# Find the right chromium binary
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

# Pick the DB client. Two strategies:
#   1. psql with explicit -h/-p/-U/-d (alpine busybox psql does not accept
#      a URL as a positional arg). Use DATABASE_URL env to extract params.
#   2. Fall back to docker exec into the postgres container (host use case).
PSQL=""
if command -v psql >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  # Parse postgresql connection URL into its parts.
  # Use bash parameter expansion to split on the LAST at-sign (so passwords
  # containing at-signs do not break the parse) and URL-decode the password
  # (real-world DATABASE_URLs escape at and colon in passwords as %40/%3A).
  URL_NO_SCHEME="${DATABASE_URL#postgresql://}"
  USER_PASS="${URL_NO_SCHEME%@*}"        # before last at-sign
  HOST_PORT_DB="${URL_NO_SCHEME##*@}"   # after last at-sign
  HOSTPORT="${HOST_PORT_DB%%/*}"
  DBNAME="${HOST_PORT_DB#*/}"
  # user is everything before the first colon in the credentials half
  USER="${USER_PASS%%:*}"
  # password is the rest of the credentials half, URL-decoded
  PGPASSWORD_RAW="${USER_PASS#*:}"
  PGPASSWORD=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]), end='')" "$PGPASSWORD_RAW")
  export PGPASSWORD
  # HOST and PORT — handle the no-port case explicitly because the
  # bash ${var#*:} / ${var%%:*} expansions do not compose well when the
  # colon is absent (they would return the whole string instead of empty).
  if [[ "$HOSTPORT" == *:* ]]; then
    HOST="${HOSTPORT%%:*}"
    PORT="${HOSTPORT#*:}"
  else
    HOST="$HOSTPORT"
    PORT=""
  fi
  PORT="${PORT:-5432}"
  PSQL="psql -h $HOST -p $PORT -U $USER -d $DBNAME"
elif command -v docker >/dev/null 2>&1; then
  PSQL="docker exec ${PG_CONTAINER:-markup-postgres} psql"
else
  echo "No psql and no docker; cannot update DB" >&2
  exit 5
fi

SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-/data/screenshots}"
PG_CONTAINER="${PG_CONTAINER:-markup-postgres}"
# Each recapture writes the new PNG to a fresh UUID-based path
# (NOT <screenshotId>.png) so the old file stays on disk and the
# ScreenshotVersion row's storageKey is unique. The Screenshot's
# own storageKey is updated to the new UUID so the /image endpoint
# serves the latest capture; the old PNGs are served only via the
# /history endpoint, which routes by storageKey per version.
NEW_VERSION_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
OUT_FILE="$SCREENSHOTS_DIR/$NEW_VERSION_ID.png"

# Look up the project domain + page path
read -r DOMAIN PATH_ < <($PSQL -t -A -F'|' \
  -c "SELECT p.domain, pa.path FROM \"Screenshot\" s JOIN \"Page\" pa ON pa.id = s.\"pageId\" JOIN \"Project\" p ON p.id = pa.\"projectId\" WHERE s.id = '$SCREENSHOT_ID'")

if [ -z "$DOMAIN" ]; then
  echo "Screenshot $SCREENSHOT_ID not found" >&2
  exit 3
fi

URL="https://${DOMAIN}${PATH_}"
echo "Re-capturing ${URL} (${WIDTH}x${HEIGHT}) -> ${OUT_FILE}"

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

# Update dimensions in the DB and bump the storageKey + capturedAt
# so the Screenshot row points at the new file. The recapture
# route's exit handler reads the row back and inserts a matching
# ScreenshotVersion row (the "history" side of the recapture).
# We also bump capturedAt to NOW() so the /status endpoint's
# ?since=… check correctly detects the change and the dashboard
# ScreenshotView's polling loop picks up the new dims on its next
# tick. The history endpoint orders by capturedAt desc, so the
# newest version surfaces at the top of the panel.
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

$PSQL -c \
  "UPDATE \"Screenshot\" SET width = $W, height = $H, \"storageKey\" = '$NEW_VERSION_ID.png', \"capturedAt\" = NOW() WHERE id = '$SCREENSHOT_ID'" >/dev/null

echo "OK: $OUT_FILE (${W}x${H})"
