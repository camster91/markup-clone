#!/usr/bin/env bash
# Smoke test for the refactored markup.io-style API.
# End-to-end: create a project (dashboard origin), then post a pin with a screenshot
# (widget auth via X-Api-Key), add a reviewer comment, resolve the pin, verify tree.
#
# Usage: bash tests/smoke.sh
#   HOST defaults to https://markup.ashbi.ca
#   DASHBOARD_HOST defaults to the value used for same-origin bypass
#
# The script must NOT print the API key to stdout (it's a real secret). The key
# is read from a tempfile that's wiped on exit.

set -euo pipefail

HOST="${HOST:-https://markup.ashbi.ca}"
PORT="${PORT:-443}"
# Resolve the fixture path. The fixture lives at tests/fixtures/test-pin.png.
# Allow override via FIXTURE_PNG env var for CI or unusual layouts.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
if [ -z "$SCRIPT_DIR" ] || [ ! -d "$SCRIPT_DIR/fixtures" ]; then
  SCRIPT_DIR="/Users/biancabienaime/markup-clone/tests"
fi
FIXTURE_PNG="${FIXTURE_PNG:-${SCRIPT_DIR}/fixtures/test-pin.png}"
KEYFILE=""
RESULT="FAIL"

cleanup() {
  if [ -n "$KEYFILE" ] && [ -f "$KEYFILE" ]; then
    shred -u "$KEYFILE" 2>/dev/null || rm -f "$KEYFILE"
  fi
  echo ""
  echo "=== $RESULT ==="
}
trap cleanup EXIT

if [ ! -f "$FIXTURE_PNG" ]; then
  echo "Fixture PNG missing: $FIXTURE_PNG" >&2
  echo "Run: python3 tests/scripts/make-test-png.py" >&2
  exit 1
fi

# Verify the fixture is a real PNG (check magic bytes)
MAGIC=$(head -c 8 "$FIXTURE_PNG" | od -An -tx1 | tr -d ' \n')
if [ "$MAGIC" != "89504e470d0a1a0a" ]; then
  echo "Fixture is not a valid PNG (magic: $MAGIC)" >&2
  exit 1
fi

echo "=== Smoke Test: ${HOST}:${PORT} ==="
echo "Fixture: $FIXTURE_PNG"

# ────────────────────────────────────────────────────────────────
# 1. Create a project via the dashboard (same-origin bypass).
#    The response includes the per-project apiKey.
# ────────────────────────────────────────────────────────────────
echo -n "[1/5] Create project (same-origin)... "
CREATE_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/projects" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d "{\"name\":\"smoke-test-$(date +%s)\",\"domain\":\"smoke-test.ashbi.ca\"}")
CREATE_HTTP=$(echo "$CREATE_RESP" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESP" | head -1)

if [ "$CREATE_HTTP" != "201" ] && [ "$CREATE_HTTP" != "200" ]; then
  echo "HTTP $CREATE_HTTP"
  echo "  body: $CREATE_BODY" >&2
  exit 1
fi

PROJECT_ID=$(echo "$CREATE_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
KEYFILE=$(mktemp)
API_KEY=$(echo "$CREATE_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('apiKey', ''))")
echo "$API_KEY" > "$KEYFILE"
chmod 600 "$KEYFILE"

if [ -z "$PROJECT_ID" ] || [ -z "$API_KEY" ]; then
  echo "missing projectId or apiKey in response"
  exit 1
fi
echo "OK (project_id=$PROJECT_ID)"

# ────────────────────────────────────────────────────────────────
# 2. Post a pin with a screenshot (widget auth via X-Api-Key).
#    The server creates the Page, Screenshot, Pin, and first Comment in one call.
# ────────────────────────────────────────────────────────────────
echo -n "[2/5] Post pin with screenshot... "
PIN_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pins" \
  -H "X-Api-Key: $(cat "$KEYFILE")" \
  -H "Origin: https://smoke-test.ashbi.ca" \
  -F "projectId=${PROJECT_ID}" \
  -F "path=/" \
  -F "xPercent=42.5" \
  -F "yPercent=67.3" \
  --form-string 'elementXPath=body > h1' \
  --form-string 'elementHTML=<h1>Smoke</h1>' \
  -F "text=Smoke test pin" \
  -F "authorName=SmokeBot" \
  -F "screenshot=@${FIXTURE_PNG};type=image/png")
PIN_HTTP=$(echo "$PIN_RESP" | tail -1)
PIN_BODY=$(echo "$PIN_RESP" | head -1)

if [ "$PIN_HTTP" != "201" ] && [ "$PIN_HTTP" != "200" ]; then
  echo "HTTP $PIN_HTTP"
  echo "  body: $PIN_BODY" >&2
  exit 1
fi

PIN_ID=$(echo "$PIN_BODY" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('pin',{}).get('id',''))")
SHOT_ID=$(echo "$PIN_BODY" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('screenshot',{}).get('id',''))")

if [ -z "$PIN_ID" ] || [ -z "$SHOT_ID" ]; then
  echo "missing pin or screenshot id"
  echo "  body: $PIN_BODY" >&2
  exit 1
fi
echo "OK (pin_id=$PIN_ID, screenshot_id=$SHOT_ID)"

# ────────────────────────────────────────────────────────────────
# 3. Add a reviewer comment to the pin (dashboard origin).
# ────────────────────────────────────────────────────────────────
echo -n "[3/5] Add reviewer comment... "
COMMENT_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pins/${PIN_ID}/comments" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d "{\"text\":\"Reviewed, looks fine.\",\"author\":\"smoke-reviewer\",\"authorRole\":\"reviewer\"}")
COMMENT_HTTP=$(echo "$COMMENT_RESP" | tail -1)

if [ "$COMMENT_HTTP" != "201" ] && [ "$COMMENT_HTTP" != "200" ]; then
  echo "HTTP $COMMENT_HTTP"
  exit 1
fi
echo "OK"

# ────────────────────────────────────────────────────────────────
# 4. Resolve the pin.
# ────────────────────────────────────────────────────────────────
echo -n "[4/5] Resolve pin... "
RESOLVE_RESP=$(curl -skS -w "\n%{http_code}" -X PATCH "${HOST}:${PORT}/api/pins/${PIN_ID}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d '{"status":"RESOLVED"}')
RESOLVE_HTTP=$(echo "$RESOLVE_RESP" | tail -1)

if [ "$RESOLVE_HTTP" != "200" ]; then
  echo "HTTP $RESOLVE_HTTP"
  exit 1
fi
echo "OK"

# ────────────────────────────────────────────────────────────────
# 5. Fetch the screenshot via the public image endpoint and verify bytes.
# ────────────────────────────────────────────────────────────────
echo -n "[5/7] Fetch screenshot image... "
SHOT_HTTP=$(curl -skS -o /tmp/smoke-shot.png -w "%{http_code}" "${HOST}:${PORT}/api/screenshots/${SHOT_ID}/image")
SHOT_SIZE=$(stat -f %z /tmp/smoke-shot.png 2>/dev/null || stat -c %s /tmp/smoke-shot.png 2>/dev/null)

if [ "$SHOT_HTTP" != "200" ]; then
  echo "HTTP $SHOT_HTTP"
  exit 1
fi

if [ "$SHOT_SIZE" != "3238" ] && [ "$SHOT_SIZE" != "4841" ]; then
  echo "got $SHOT_SIZE bytes (expected 3238 or 4841)"
  exit 1
fi
rm -f /tmp/smoke-shot.png
echo "OK (${SHOT_SIZE} bytes)"

# ────────────────────────────────────────────────────────────────
# 5b. Reopen the resolved pin by adding a reviewer comment.
# ────────────────────────────────────────────────────────────────
echo -n "[5b/7] Reopen pin via reviewer comment... "
REOPEN_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pins/${PIN_ID}/comments" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d '{"text":"Not quite there yet — please revisit.","author":"smoke-reviewer","authorRole":"reviewer"}')
REOPEN_HTTP=$(echo "$REOPEN_RESP" | tail -1)

if [ "$REOPEN_HTTP" != "201" ] && [ "$REOPEN_HTTP" != "200" ]; then
  echo "HTTP $REOPEN_HTTP"
  exit 1
fi
echo "OK"

# ────────────────────────────────────────────────────────────────
# 6. Subscribe a fake email address to the project.
# ────────────────────────────────────────────────────────────────
echo -n "[6/7] Subscribe email to project... "
SUB_EMAIL="smoke+$(date +%s)@ashbi.ca"
SUB_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/projects/${PROJECT_ID}/subscribers" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d "{\"email\":\"${SUB_EMAIL}\"}")
SUB_HTTP=$(echo "$SUB_RESP" | tail -1)

if [ "$SUB_HTTP" != "201" ] && [ "$SUB_HTTP" != "200" ]; then
  echo "HTTP $SUB_HTTP"
  exit 1
fi
echo "OK (${SUB_EMAIL})"

# ────────────────────────────────────────────────────────────────
# 7/7. Verify widget.js contains the new behavior patterns:
#    - scrollHeight (full-page capture, task 1)
#    - outline (hover outline, task 2)
# ────────────────────────────────────────────────────────────────
echo -n "[7/7] Widget contains hover-outline and full-page capture... "
WIDGET_RESP=$(curl -skS -w "\n%{http_code}" "${HOST}:${PORT}/widget.js" -o /tmp/smoke-widget.js)
WIDGET_HTTP=$(echo "$WIDGET_RESP" | tail -1)

if [ "$WIDGET_HTTP" != "200" ]; then
  echo "HTTP $WIDGET_HTTP"
  exit 1
fi

HAS_OUTLINE=$(grep -c 'outline' /tmp/smoke-widget.js 2>/dev/null || echo 0)
HAS_SCROLLHEIGHT=$(grep -c 'scrollHeight' /tmp/smoke-widget.js 2>/dev/null || echo 0)
rm -f /tmp/smoke-widget.js

if [ "$HAS_OUTLINE" -gt 0 ] && [ "$HAS_SCROLLHEIGHT" -gt 0 ]; then
  echo "PASS (outline=$HAS_OUTLINE, scrollHeight=$HAS_SCROLLHEIGHT)"
else
  echo "FAIL (outline=$HAS_OUTLINE, scrollHeight=$HAS_SCROLLHEIGHT — expected both > 0)"
  exit 1
fi

# ────────────────────────────────────────────────────────────────
# 8. Rename the project to "Smoke Renamed" and verify.
# ────────────────────────────────────────────────────────────────
echo -n "[8/9] Rename project to Smoke Renamed... "
RENAME_RESP=$(curl -skS -w "\n%{http_code}" -X PATCH "${HOST}:${PORT}/api/projects/${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d '{"name":"Smoke Renamed"}')
RENAME_HTTP=$(echo "$RENAME_RESP" | tail -1)
RENAME_BODY=$(echo "$RENAME_RESP" | head -1)

if [ "$RENAME_HTTP" != "200" ]; then
  echo "HTTP $RENAME_HTTP"
  echo "  body: $RENAME_BODY" >&2
  exit 1
fi

RENAME_NAME=$(echo "$RENAME_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('name', ''))")
if [ "$RENAME_NAME" != "Smoke Renamed" ]; then
  echo "expected name 'Smoke Renamed', got '$RENAME_NAME'"
  exit 1
fi
echo "OK"

# ────────────────────────────────────────────────────────────────
# 9. Create a throwaway project, delete it, then verify it's gone.
# ────────────────────────────────────────────────────────────────
echo -n "[9/9] Delete throwaway project and verify... "
DELETE_CREATE_RESP=$(curl -skS -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/projects" \
  -H "Content-Type: application/json" \
  -H "Origin: ${HOST}" \
  -d '{"name":"smoke-delete-$(date +%s)","domain":"smoke-delete.ashbi.ca"}')
DELETE_CREATE_HTTP=$(echo "$DELETE_CREATE_RESP" | tail -1)
DELETE_CREATE_BODY=$(echo "$DELETE_CREATE_RESP" | head -1)

if [ "$DELETE_CREATE_HTTP" != "201" ] && [ "$DELETE_CREATE_HTTP" != "200" ]; then
  echo "HTTP $DELETE_CREATE_HTTP"
  echo "  body: $DELETE_CREATE_BODY" >&2
  exit 1
fi

DELETE_ID=$(echo "$DELETE_CREATE_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
if [ -z "$DELETE_ID" ]; then
  echo "missing delete project id"
  exit 1
fi

DELETE_RESP=$(curl -skS -w "\n%{http_code}" -X DELETE "${HOST}:${PORT}/api/projects/${DELETE_ID}" \
  -H "Origin: ${HOST}")
DELETE_HTTP=$(echo "$DELETE_RESP" | tail -1)

if [ "$DELETE_HTTP" != "200" ]; then
  echo "HTTP $DELETE_HTTP"
  exit 1
fi

# Verify the deleted project is gone
LIST_RESP=$(curl -skS -X GET "${HOST}:${PORT}/api/projects" \
  -H "Origin: ${HOST}")
STILL_THERE=$(echo "$LIST_RESP" | python3 -c "import sys, json; ids=[p.get('id') for p in json.load(sys.stdin)]; print('yes' if '$DELETE_ID' in ids else 'no')")
if [ "$STILL_THERE" != "no" ]; then
  echo "FAIL — deleted project $DELETE_ID still appears in project list"
  exit 1
fi
echo "OK"

RESULT="PASS"
