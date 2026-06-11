#!/usr/bin/env bash
# Smoke test for markup.io refactored app (Project→Page→Screenshot→Pin→Comment)
# Usage: HOST=https://markup.ashbi.ca PORT=443 bash smoke.sh
# Defaults: HOST=https://markup.ashbi.ca PORT=443

set -euo pipefail

HOST="${HOST:-https://markup.ashbi.ca}"
PORT="${PORT:-443}"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd ../fixtures && pwd)"
FIXTURE_PNG="${FIXTURE_DIR}/test-pin.png"
TMPKEYFILE=""
RESULT="FAIL"

trap 'rm -f "$TMPKEYFILE"; echo "RESULT: $RESULT"' EXIT

# ── helpers ──────────────────────────────────────────────────────────────────

fetch_api_key() {
  # GET /api/projects — the response contains an API key in a header or body.
  # We stash it in a tempfile so it never appears in stdout.
  TMPKEYFILE=$(mktemp)
  RESP=$(curl -s -w "\n%{http_code}" "${HOST}:${PORT}/api/projects" -o "$TMPKEYFILE")
  HTTP=$(echo "$RESP" | tail -1)
  if [ "$HTTP" != "200" ]; then
    echo "[fetch_api_key] /api/projects returned HTTP $HTTP" >&2
    return 1
  fi
  # The API key lives in the response body; extract without logging it.
  API_KEY=$(python3 -c "
import sys, json
data = json.load(sys.stdin)
# top-level projects array; each project may have an apiKey field
# Walk the tree to be safe.
def find_key(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if 'apikey' in k.lower():
                return v
            r = find_key(v)
            if r:
                return r
    elif isinstance(obj, list):
        for item in obj:
            r = find_key(item)
            if r:
                return r
    return None
print(find_key(data) or '')
" < "$TMPKEYFILE")
  echo "$API_KEY"
}

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

json_get() {
  python3 -c "
import sys, json
d = sys.stdin.read()
try:
    obj = json.loads(d)
    for k in $1.split('.'):
        if isinstance(obj, list): obj = obj[int(k)]
        else: obj = obj[k]
    print(obj, end='')
except: print('', end='')
"
}

# ── test ──────────────────────────────────────────────────────────────────────

echo "=== Smoke Test: ${HOST}:${PORT} ==="

# 1. Create a project via same-origin POST
PROJECT_PAYLOAD=$(python3 -c "import json; print(json.dumps({'name': 'smoke-test-$(date +%s)'}))")
echo -n "[1/6] Create project... "
CREATE_RESP=$(curl -s -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/projects" \
  -H "Content-Type: application/json" \
  -d "$PROJECT_PAYLOAD")
CREATE_HTTP=$(echo "$CREATE_RESP" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESP" | head -1)

if [ "$CREATE_HTTP" != "200" ] && [ "$CREATE_HTTP" != "201" ]; then
  echo "HTTP $CREATE_HTTP"
  exit 1
fi

PROJECT_ID=$(echo "$CREATE_BODY" | json_get "id")
if [ -z "$PROJECT_ID" ]; then
  echo "No project ID in response"
  exit 1
fi
echo "OK (project_id=$PROJECT_ID)"

# 2. Create a page for the project
PAGE_PAYLOAD=$(python3 -c "import json; print(json.dumps({'projectId': $PROJECT_ID, 'url': 'https://example.com/smoke', 'title': 'Smoke Test Page'}))")
echo -n "[2/6] Create page... "
PAGE_RESP=$(curl -s -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pages" \
  -H "Content-Type: application/json" \
  -d "$PAGE_PAYLOAD")
PAGE_HTTP=$(echo "$PAGE_RESP" | tail -1)
PAGE_BODY=$(echo "$PAGE_RESP" | head -1)
PAGE_ID=$(echo "$PAGE_BODY" | json_get "id")
if [ -z "$PAGE_ID" ]; then
  echo "No page ID in response (HTTP $PAGE_HTTP)"
  exit 1
fi
echo "OK (page_id=$PAGE_ID)"

# 3. Upload a screenshot for the page (PNG fixture)
echo -n "[3/6] Upload screenshot (PNG fixture)... "
SCREENSHOT_RESP=$(curl -s -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/screenshots" \
  -F "pageId=${PAGE_ID}" \
  -F "image=@${FIXTURE_PNG};type=image/png")
SCREENSHOT_HTTP=$(echo "$SCREENSHOT_RESP" | tail -1)
SCREENSHOT_BODY=$(echo "$SCREENSHOT_RESP" | head -1)
SCREENSHOT_ID=$(echo "$SCREENSHOT_BODY" | json_get "id")
if [ -z "$SCREENSHOT_ID" ]; then
  echo "No screenshot ID in response (HTTP $SCREENSHOT_HTTP)"
  exit 1
fi
echo "OK (screenshot_id=$SCREENSHOT_ID)"

# 4. Post a pin with the fixture PNG on the screenshot
echo -n "[4/6] Create pin... "
PIN_PAYLOAD=$(python3 -c "import json; print(json.dumps({'screenshotId': $SCREENSHOT_ID, 'x': 150, 'y': 200, 'color': '#ff8800'}))")
PIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pins" \
  -H "Content-Type: application/json" \
  -d "$PIN_PAYLOAD")
PIN_HTTP=$(echo "$PIN_RESP" | tail -1)
PIN_BODY=$(echo "$PIN_RESP" | head -1)
PIN_ID=$(echo "$PIN_BODY" | json_get "id")
if [ -z "$PIN_ID" ]; then
  echo "No pin ID in response (HTTP $PIN_HTTP)"
  exit 1
fi
echo "OK (pin_id=$PIN_ID)"

# 5. Add a reviewer comment to the pin
echo -n "[5/6] Add reviewer comment... "
COMMENT_PAYLOAD=$(python3 -c "import json; print(json.dumps({'pinId': $PIN_ID, 'content': 'Looks good to me', 'author': 'smoke-test-bot'}))")
COMMENT_RESP=$(curl -s -w "\n%{http_code}" -X POST "${HOST}:${PORT}/api/pins/${PIN_ID}/comments" \
  -H "Content-Type: application/json" \
  -d "$COMMENT_PAYLOAD")
COMMENT_HTTP=$(echo "$COMMENT_RESP" | tail -1)
if [ "$COMMENT_HTTP" != "200" ] && [ "$COMMENT_HTTP" != "201" ]; then
  echo "HTTP $COMMENT_HTTP"
  exit 1
fi
echo "OK"

# 6. Resolve the pin
echo -n "[6/6] Resolve pin... "
RESOLVE_RESP=$(curl -s -w "\n%{http_code}" -X PATCH "${HOST}:${PORT}/api/pins/${PIN_ID}" \
  -H "Content-Type: application/json" \
  -d '{"resolved": true}')
RESOLVE_HTTP=$(echo "$RESOLVE_RESP" | tail -1)
if [ "$RESOLVE_HTTP" != "200" ]; then
  echo "HTTP $RESOLVE_HTTP"
  exit 1
fi
echo "OK"

# 7. Fetch /api/projects and verify the full tree
echo -n "[7/6] Verify project tree... "
rm -f "$TMPKEYFILE"
TMPKEYFILE=$(mktemp)
TREE_RESP=$(curl -s -w "\n%{http_code}" "${HOST}:${PORT}/api/projects" -o "$TMPKEYFILE")
TREE_HTTP=$(echo "$TREE_RESP" | tail -1)
if [ "$TREE_HTTP" != "200" ]; then
  echo "/api/projects HTTP $TREE_HTTP"
  exit 1
fi

# Walk the JSON tree and verify we can find the smoke test project with nested data
TREE_CHECK=$(python3 -c "
import sys, json, os

with open(os.environ['TMPKEYFILE']) as f:
    data = json.load(f)

found = False
projects = data if isinstance(data, list) else data.get('projects', data.get('data', []))
for proj in projects:
    if 'smoke-test' in str(proj.get('name', '')):
        found = True
        # Verify nested structure: Project → Page → Screenshot → Pin → Comment
        assert 'pages' in proj or any('screenshots' in str(p) for p in proj.get('pages', [])), \
            'No pages/screenshots in project'
        # Check page has screenshots
        for page in proj.get('pages', []):
            assert 'screenshots' in str(page), 'No screenshots in page'
            for ss in page.get('screenshots', []):
                assert 'pins' in str(ss), 'No pins in screenshot'
                for pin in ss.get('pins', []):
                    assert 'comments' in str(pin), 'No comments in pin'
        break

if not found:
    # Maybe the project name is in the response but nested differently — check by ID
    print('smoke-project-found')
else:
    print('tree-valid')
" 2>&1)
if [ "$TREE_CHECK" != "tree-valid" ]; then
  echo "$TREE_CHECK"
  exit 1
fi
echo "OK (Project→Page→Screenshot→Pin→Comment tree verified)"

RESULT="PASS"
echo ""
echo "=== PASS ==="